import { REACTION_KINDS } from "@futary/contract";
import { implementer } from "../implementer";
import { isConstraintViolation } from "./couple";
import { createGetUrl, imageKeyFor, MAX_IMAGE_BYTES, resolveUserImage, type R2SignConfig } from "../lib/r2-signed-url";
import { readProcedure, writeProcedure } from "./base";

const PAGE_SIZE = 20;
// contract の postUploadUrlContract（z.literal）と同じ値。署名付きPUT URLは
// Content-Type を強制できないため、実体確認のタイミングで検証する
const UPLOAD_CONTENT_TYPE = "image/jpeg";

interface PostRow {
  id: string;
  author_id: string;
  author_name: string | null;
  author_image: string | null;
  body: string;
  created_at: number;
}

// 投稿カードに投稿者名・アバターを出すため user テーブルを LEFT JOIN する
// （008・architecture.md 5節。理由と到達可能性の注記も同節参照）。
// posts を couple_id で絞った結果に対して行い、user 側を起点に引かない
// （認可の範囲を JOIN で広げない）
const POST_COLUMNS =
  "posts.id AS id, posts.author_id AS author_id, user.name AS author_name, " +
  "user.image AS author_image, posts.body AS body, posts.created_at AS created_at";
const POST_FROM = "posts LEFT JOIN user ON user.id = posts.author_id";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface ReactionSummary {
  kind: (typeof REACTION_KINDS)[number];
  count: number;
  reactedByMe: boolean;
}

interface ReactionSummaryRow {
  post_id: string;
  kind: string;
  count: number;
  reacted_by_me: number;
}

// 投稿一覧の取得と合わせて1〜2クエリで解決する（タスク009。N+1にしない）。
// pageRows の投稿IDをまとめて1クエリで集計し、Map にして返す。
// postIds が空なら SQL を投げずに空 Map を返す（IN () は不正なSQLになるため）
async function fetchReactionSummaries(
  db: D1Database,
  postIds: readonly string[],
  userId: string | null,
): Promise<Map<string, ReactionSummary[]>> {
  const summaries = new Map<string, ReactionSummary[]>();
  if (postIds.length === 0) return summaries;

  // userId が null（未認証のデモ閲覧）のときは reacted_by_me が常に false になる。
  // SQLite の `user_id = NULL` は常に偽と評価されるため、明示的な分岐は不要
  const placeholders = postIds.map((_, i) => `?${i + 2}`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT post_id AS post_id, kind AS kind, COUNT(*) AS count,
              MAX(CASE WHEN user_id = ?1 THEN 1 ELSE 0 END) AS reacted_by_me
         FROM reactions
        WHERE post_id IN (${placeholders})
        GROUP BY post_id, kind`,
    )
    .bind(userId, ...postIds)
    .all<ReactionSummaryRow>();

  for (const row of results) {
    const list = summaries.get(row.post_id) ?? [];
    list.push({
      kind: row.kind as ReactionSummary["kind"],
      count: row.count,
      reactedByMe: row.reacted_by_me === 1,
    });
    summaries.set(row.post_id, list);
  }
  return summaries;
}

// 031: 1投稿に画像を4枚まで（post_images。position順）
interface PostImageRow {
  post_id: string;
  position: number;
  key: string;
  width: number;
  height: number;
}

// 投稿一覧の取得と合わせて1〜2クエリで解決する（fetchReactionSummariesと同じ形。
// N+1にしない）。ORDER BY post_id, position で返すため、Map に積む順序が
// そのまま並び順になる
async function fetchPostImages(db: D1Database, postIds: readonly string[]): Promise<Map<string, PostImageRow[]>> {
  const imagesByPost = new Map<string, PostImageRow[]>();
  if (postIds.length === 0) return imagesByPost;

  const placeholders = postIds.map((_, i) => `?${i + 1}`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT post_id AS post_id, position AS position, key AS key, width AS width, height AS height
         FROM post_images
        WHERE post_id IN (${placeholders})
        ORDER BY post_id, position`,
    )
    .bind(...postIds)
    .all<PostImageRow>();

  for (const row of results) {
    const list = imagesByPost.get(row.post_id) ?? [];
    list.push(row);
    imagesByPost.set(row.post_id, list);
  }
  return imagesByPost;
}

// 署名付き GET URL を発行する（有効期限1時間。architecture.md 6節）。
// 鍵そのものはクライアントに渡さず、都度発行し直す短命URLだけを渡す
async function toPost(
  row: PostRow,
  imageRows: PostImageRow[],
  r2Sign: R2SignConfig,
  reactions: ReactionSummary[] = [],
) {
  const images = await Promise.all(
    imageRows.map(async (image) => ({
      url: await createGetUrl(r2Sign, image.key),
      width: image.width,
      height: image.height,
    })),
  );
  // authorImageはGoogleの外部URLか、投稿者が自分でアップロードした画像の
  // R2キーのどちらもありうる。後者だけ署名付きGET URLへ解決する（019）
  const authorImage = await resolveUserImage(r2Sign, row.author_image);
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorImage,
    body: row.body,
    images,
    createdAt: row.created_at,
    reactions,
  };
}

interface Cursor {
  createdAt: number;
  id: string;
}

// カーソルは created_at と id の複合を不透明な文字列にエンコードしたもの
// （architecture.md 4節・タスク006）。同一秒の投稿がページ境界をまたいでも、
// id をタイブレークに使うことで一覧の重複・欠落を防ぐ
function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor));
}

function decodeCursor(value: string): Cursor {
  const parsed: unknown = JSON.parse(atob(value));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Cursor).createdAt !== "number" ||
    typeof (parsed as Cursor).id !== "string"
  ) {
    throw new Error("cursor の形式が不正です");
  }
  return { createdAt: (parsed as Cursor).createdAt, id: (parsed as Cursor).id };
}

// ctx.coupleId のみを使い、couple_id を引数に取らない（architecture.md 5節）
const postList = implementer.post.list.use(readProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, r2Sign } = context;

  let cursor: Cursor | null = null;
  if (input.cursor) {
    try {
      cursor = decodeCursor(input.cursor);
    } catch {
      throw errors.INVALID_INPUT();
    }
  }

  // 次ページの有無を1回のクエリで判定するため PAGE_SIZE + 1 件取得する
  const stmt = cursor
    ? db
        .prepare(
          `SELECT ${POST_COLUMNS} FROM ${POST_FROM}
            WHERE posts.couple_id = ?1 AND posts.deleted_at IS NULL
              AND (posts.created_at < ?2 OR (posts.created_at = ?2 AND posts.id < ?3))
            ORDER BY posts.created_at DESC, posts.id DESC
            LIMIT ?4`,
        )
        .bind(coupleId, cursor.createdAt, cursor.id, PAGE_SIZE + 1)
    : db
        .prepare(
          `SELECT ${POST_COLUMNS} FROM ${POST_FROM}
            WHERE posts.couple_id = ?1 AND posts.deleted_at IS NULL
            ORDER BY posts.created_at DESC, posts.id DESC
            LIMIT ?2`,
        )
        .bind(coupleId, PAGE_SIZE + 1);

  const { results } = await stmt.all<PostRow>();

  const hasMore = results.length > PAGE_SIZE;
  const pageRows = hasMore ? results.slice(0, PAGE_SIZE) : results;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow ? encodeCursor({ createdAt: lastRow.created_at, id: lastRow.id }) : null;

  // 投稿一覧クエリ1回 + リアクション集計クエリ1回 + 画像一覧クエリ1回の
  // 計3クエリで解決する（タスク009・031。N+1にしない）
  const postIds = pageRows.map((row) => row.id);
  const [reactionSummaries, postImages] = await Promise.all([
    fetchReactionSummaries(db, postIds, context.userId),
    fetchPostImages(db, postIds),
  ]);
  const items = await Promise.all(
    pageRows.map((row) =>
      toPost(row, postImages.get(row.id) ?? [], r2Sign, reactionSummaries.get(row.id) ?? []),
    ),
  );
  return { items, nextCursor };
});

const postCreate = implementer.post.create.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, coupleId, userId, r2Sign } = context;

  // 031: images は空配列を「無いもの」として扱う（undefinedと区別しない）
  const images = input.images ?? [];

  // 本文（trim後）と画像がどちらも空の投稿は作れない（旧L30。architecture.md 5節）。
  // 空白のみの本文も空として扱う
  const trimmedBody = input.body.trim();
  if (trimmedBody === "" && images.length === 0) {
    throw errors.INVALID_INPUT();
  }

  // 途中で止まっても半端な投稿を作らない（タスク定義5節）。DBに1行も書く前に、
  // images の全ての imageId について R2 に実体があることを確認する
  const imageKeys: string[] = [];
  for (const image of images) {
    const imageKey = imageKeyFor(coupleId, image.imageId);
    // image_key が非NULLなら R2 に実体がある、という不変条件を保つため、
    // 書く前に確認する（architecture.md 6節）。未アップロードの imageId で
    // 投稿を作らせない。
    // 【031・security-auditor指摘】head/deleteの例外をそのまま投げると、
    // withErrorId（error-id.ts）がcatchした例外をconsole.errorへ渡すため、
    // R2のエラーメッセージに含まれうる画像キーがログに出てしまう
    // （024のme.ts deleteAllByPrefixと同じ理由。security-requirements.md
    // 8節「画像キーをログに出さない」）。031で1リクエストあたりのhead呼び出しが
    // 最大4回に増え、当たる確率も上がったため鍵を含まない汎用メッセージへ
    // 詰め替えてから投げ直す
    let head: R2Object | null;
    try {
      head = await bucket.head(imageKey);
    } catch {
      throw new Error("R2からの画像実体確認に失敗しました");
    }
    if (!head) throw errors.INVALID_INPUT();
    // サイズ上限・Content-Type はどちらも署名付きURL自体では強制できない
    // （r2-signed-url.ts のコメント参照）ため、実体確認のタイミングで検査する。
    // 圧縮を経ていない・改ざんされたアップロードを弾く。実体は残しておくと
    // 二度とこの imageId で投稿を作れなくなる（UNIQUE制約と同じ形の孤児）ため削除する
    // （007 security-auditor 指摘: Content-Type検証を追加）
    if (head.size > MAX_IMAGE_BYTES || head.httpMetadata?.contentType !== UPLOAD_CONTENT_TYPE) {
      try {
        await bucket.delete(imageKey);
      } catch {
        throw new Error("R2からの画像削除に失敗しました");
      }
      throw errors.INVALID_INPUT();
    }
    imageKeys.push(imageKey);
  }

  const id = crypto.randomUUID();
  const now = nowSeconds();
  // context.user は resolveCoupleContext が mode="member" を返した時点で必ず
  // 非null（auth-context.ts: member分岐はcontext.userがtruthyのときだけ発生する）。
  // CoupleContext の型は user と mode の対応関係を表現できないため、
  // ここではアサーションで通す（base.ts 冒頭コメントと同種の型システムの限界）
  const authorName = context.user!.name;
  const authorImage = context.user!.image;

  // posts と post_images への書き込みを1本の batch() にまとめる（architecture.md
  // 4節「条件を書き込み文のWHEREに埋め込み、更新件数で結果を判定する」の
  // 原則と同じく、途中で割れた状態を作らない）。batch()は文のエラーで
  // ロールバックするため、post_images.key のUNIQUE違反（同じimageIdが既に
  // 使われている）が起きればpostsへのINSERTごと取り消される
  const statements = [
    db
      .prepare(`INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(id, coupleId, userId, trimmedBody, now),
    ...images.map((image, position) =>
      db
        .prepare(
          `INSERT INTO post_images (post_id, position, key, width, height) VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(id, position, imageKeys[position], image.width, image.height),
    ),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    // post_images.key の UNIQUE 違反 = 同じ imageId が既に別の投稿に使われている
    if (isConstraintViolation(error)) throw errors.INVALID_INPUT();
    throw error;
  }

  return toPost(
    {
      id,
      author_id: userId,
      author_name: authorName,
      author_image: authorImage,
      body: input.body,
      created_at: now,
    },
    images.map((image, position) => ({
      post_id: id,
      position,
      key: imageKeys[position] as string,
      width: image.width,
      height: image.height,
    })),
    r2Sign,
  );
});

// WHERE 句に couple_id = ctx.coupleId を含めて1文で行う（タスク006）。
// 他ペアの投稿ID・存在しないID・既に削除済みのIDはすべて更新件数0となり、
// 区別せず NOT_FOUND を返す
const postDelete = implementer.post.delete.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, coupleId } = context;

  // D1 を先に更新し、そのあと R2 の削除を試みる（architecture.md 6節）。
  // 逆順にすると「投稿は残るのに画像が消える」壊れ方が利用者から見えてしまう。
  // reactions・post_images の削除を同じ batch に含める（M2まとめ監査 Low指摘 /
  // 031タスク定義6節）。DELETE 文にも couple_id 条件を EXISTS で含める必要が
  // ある。含めないと、他ペアの投稿IDを指定した場合 UPDATE は0件で NOT_FOUND
  // になる一方 DELETE だけが無条件で成立してしまい、「投稿は消せないが
  // 画像だけ消せる」経路が生まれる（reactionsで実装時に実際に検出した形と同じ）。
  // post_images は論理削除を持たせない（行が残ると key の UNIQUE が空きを塞ぐ。
  // 031タスク定義6節）ため、ここで物理削除する
  const batchResults = await db.batch<{ id?: string; key?: string; width?: number; height?: number }>([
    db
      .prepare(
        `UPDATE posts SET deleted_at = ?1
          WHERE id = ?2 AND couple_id = ?3 AND deleted_at IS NULL
         RETURNING id AS id`,
      )
      .bind(nowSeconds(), input.id, coupleId),
    db
      .prepare(
        `DELETE FROM reactions
          WHERE post_id = ?1
            AND EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND couple_id = ?2)`,
      )
      .bind(input.id, coupleId),
    db
      .prepare(
        `DELETE FROM post_images
          WHERE post_id = ?1
            AND EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND couple_id = ?2)
         RETURNING key AS key, width AS width, height AS height`,
      )
      .bind(input.id, coupleId),
  ]);

  const row = batchResults[0]?.results[0];
  if (!row) throw errors.NOT_FOUND();

  const imageKeys = (batchResults[2]?.results ?? [])
    .map((image) => image.key)
    .filter((key): key is string => typeof key === "string");

  if (imageKeys.length > 0) {
    try {
      await bucket.delete(imageKeys);
    } catch {
      // R2 の削除に失敗しても post.delete は成功として返す（利用者の操作を
      // 掃除の失敗で失敗させない）。post_images の行は既に消えているため、
      // 失敗した分は孤児オブジェクトとしてR2に残る（架空リンクの参照は
      // 無くなるため開示の実害は無い。architecture.md 6節）。
      // 画像キーはログに出さない（security-requirements.md 8節）
    }
  }

  return { id: input.id };
});

export const postProcedures = {
  list: postList,
  create: postCreate,
  delete: postDelete,
};

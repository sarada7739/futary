import { REACTION_KINDS } from "@futary/contract";
import { implementer } from "../implementer";
import { isConstraintViolation } from "./couple";
import { createGetUrl, imageKeyFor, MAX_IMAGE_BYTES, type R2SignConfig } from "../lib/r2-signed-url";
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
  image_key: string | null;
  image_width: number | null;
  image_height: number | null;
  created_at: number;
}

// 投稿カードに投稿者名・アバターを出すため user テーブルを LEFT JOIN する
// （008・architecture.md 5節。理由と到達可能性の注記も同節参照）。
// posts を couple_id で絞った結果に対して行い、user 側を起点に引かない
// （認可の範囲を JOIN で広げない）
const POST_COLUMNS =
  "posts.id AS id, posts.author_id AS author_id, user.name AS author_name, " +
  "user.image AS author_image, posts.body AS body, posts.image_key AS image_key, " +
  "posts.image_width AS image_width, posts.image_height AS image_height, posts.created_at AS created_at";
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

// image_key が非NULLなら署名付き GET URL を発行する（有効期限1時間。architecture.md 6節）。
// 鍵そのものはクライアントに渡さず、都度発行し直す短命URLだけを渡す
async function toPost(row: PostRow, r2Sign: R2SignConfig, reactions: ReactionSummary[] = []) {
  const imageUrl = row.image_key ? await createGetUrl(r2Sign, row.image_key) : null;
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorImage: row.author_image,
    body: row.body,
    imageUrl,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
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

  // 投稿一覧クエリ1回 + リアクション集計クエリ1回の計2クエリで解決する（タスク009）
  const reactionSummaries = await fetchReactionSummaries(
    db,
    pageRows.map((row) => row.id),
    context.userId,
  );
  const items = await Promise.all(
    pageRows.map((row) => toPost(row, r2Sign, reactionSummaries.get(row.id) ?? [])),
  );
  return { items, nextCursor };
});

const postCreate = implementer.post.create.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, coupleId, userId, r2Sign } = context;

  // 本文（trim後）と画像がどちらも空の投稿は作れない（旧L30。architecture.md 5節）。
  // 空白のみの本文も空として扱う
  const trimmedBody = input.body.trim();
  if (trimmedBody === "" && !input.imageId) {
    throw errors.INVALID_INPUT();
  }

  let imageKey: string | null = null;
  if (input.imageId) {
    imageKey = imageKeyFor(coupleId, input.imageId);
    // image_key が非NULLなら R2 に実体がある、という不変条件を保つため、
    // 書く前に確認する（architecture.md 6節）。未アップロードの imageId で
    // 投稿を作らせない
    const head = await bucket.head(imageKey);
    if (!head) throw errors.INVALID_INPUT();
    // サイズ上限・Content-Type はどちらも署名付きURL自体では強制できない
    // （r2-signed-url.ts のコメント参照）ため、実体確認のタイミングで検査する。
    // 圧縮を経ていない・改ざんされたアップロードを弾く。実体は残しておくと
    // 二度とこの imageId で投稿を作れなくなる（UNIQUE制約と同じ形の孤児）ため削除する
    // （007 security-auditor 指摘: Content-Type検証を追加）
    if (head.size > MAX_IMAGE_BYTES || head.httpMetadata?.contentType !== UPLOAD_CONTENT_TYPE) {
      await bucket.delete(imageKey);
      throw errors.INVALID_INPUT();
    }
  }

  const id = crypto.randomUUID();
  const now = nowSeconds();
  const imageWidth = input.imageWidth ?? null;
  const imageHeight = input.imageHeight ?? null;
  // context.user は resolveCoupleContext が mode="member" を返した時点で必ず
  // 非null（auth-context.ts: member分岐はcontext.userがtruthyのときだけ発生する）。
  // CoupleContext の型は user と mode の対応関係を表現できないため、
  // ここではアサーションで通す（base.ts 冒頭コメントと同種の型システムの限界）
  const authorName = context.user!.name;
  const authorImage = context.user!.image;

  try {
    await db
      .prepare(
        `INSERT INTO posts (id, couple_id, author_id, body, image_key, image_width, image_height, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(id, coupleId, userId, input.body, imageKey, imageWidth, imageHeight, now)
      .run();
  } catch (error) {
    // image_key の UNIQUE 違反 = 同じ imageId が既に別の投稿に使われている
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
      image_key: imageKey,
      image_width: imageWidth,
      image_height: imageHeight,
      created_at: now,
    },
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
  // RETURNING で image_key を受け取り、削除対象を再度 SELECT しない。
  // reactions の削除を同じ batch に含める（M2まとめ監査 Low指摘: 論理削除後も
  // リアクション行が永久に残留していた）。DELETE 文にも couple_id 条件を
  // EXISTS で含める必要がある。含めないと、他ペアの投稿IDを指定した場合
  // UPDATE は0件で NOT_FOUND になる一方 DELETE だけが無条件で成立してしまい、
  // 「投稿は消せないがリアクションだけ消せる」経路が生まれる
  // （実装時に post.test.ts 相当のテストで実際に検出した）
  const batchResults = await db.batch<{ image_key: string | null }>([
    db
      .prepare(
        `UPDATE posts SET deleted_at = ?1
          WHERE id = ?2 AND couple_id = ?3 AND deleted_at IS NULL
         RETURNING image_key AS image_key`,
      )
      .bind(nowSeconds(), input.id, coupleId),
    db
      .prepare(
        `DELETE FROM reactions
          WHERE post_id = ?1
            AND EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND couple_id = ?2)`,
      )
      .bind(input.id, coupleId),
  ]);

  const row = batchResults[0]?.results[0];
  if (!row) throw errors.NOT_FOUND();

  if (row.image_key) {
    try {
      await bucket.delete(row.image_key);
    } catch {
      // R2 の削除に失敗しても post.delete は成功として返す（利用者の操作を
      // 掃除の失敗で失敗させない）。image_key は消さないため孤児は後から回収できる。
      // image_key はログに出さない（security-requirements.md 8節）
    }
  }

  return { id: input.id };
});

export const postProcedures = {
  list: postList,
  create: postCreate,
  delete: postDelete,
};

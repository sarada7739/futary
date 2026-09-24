import { REACTION_KINDS } from "@futary/contract";
import { implementer } from "../implementer";
import { isConstraintViolation } from "./couple";
import { createGetUrl, imageKeyFor, MAX_IMAGE_BYTES, resolveUserImage, type R2SignConfig } from "../lib/r2-signed-url";
import { readProcedure, writeProcedure } from "./base";

const PAGE_SIZE = 20;
// 契約の postUploadUrlContract（z.literal）と同じ値。署名付き PUT URL は Content-Type を強制できないので、
// 実体を確かめるときに見る
const UPLOAD_CONTENT_TYPE = "image/jpeg";

interface PostRow {
  id: string;
  author_id: string;
  author_name: string | null;
  author_image: string | null;
  body: string;
  created_at: number;
}

// 投稿者名・アバターのため user を LEFT JOIN する。posts を couple_id で絞った結果に対して行い、
// user 側を起点に引かない（認可の範囲を JOIN で広げない。architecture.md 5節）
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

// ページの投稿 ID をまとめて 1 クエリで集計する（N+1 にしない）。
// postIds が空なら SQL を投げない（IN () は不正な SQL）
async function fetchReactionSummaries(
  db: D1Database,
  postIds: readonly string[],
  userId: string | null,
): Promise<Map<string, ReactionSummary[]>> {
  const summaries = new Map<string, ReactionSummary[]>();
  if (postIds.length === 0) return summaries;

  // userId が null（デモ閲覧）なら `user_id = NULL` は常に偽なので、reacted_by_me は分岐なしで false になる
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

// 1 投稿に画像 4 枚まで（position 順。031）
interface PostImageRow {
  post_id: string;
  position: number;
  key: string;
  width: number;
  height: number;
}

// fetchReactionSummaries と同じく 1 クエリ。ORDER BY post_id, position なので Map に積む順がそのまま並び順
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

// 鍵はクライアントに渡さず、都度発行する短命の署名付き GET URL だけを渡す（1 時間。architecture.md 6節）
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
  // authorImage は Google の外部 URL か自分で上げた画像の R2 キー。後者だけ署名付き URL にする
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

// カーソルは (created_at, id) を不透明な文字列にしたもの。同じ秒の投稿がページ境界をまたいでも
// id で順が決まり、重複・欠落しない（architecture.md 4節）
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

// couple_id を引数に取らない（architecture.md 5節）
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

  // 次ページの有無を 1 回のクエリで判定するため PAGE_SIZE + 1 件取る
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

  // 一覧 1 回 + リアクション 1 回 + 画像 1 回の計 3 クエリ（N+1 にしない）
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

  // 空配列は「無い」と同じ
  const images = input.images ?? [];

  // 本文（trim 後。空白だけも空）と画像がどちらも空の投稿は作れない（architecture.md 5節）
  const trimmedBody = input.body.trim();
  if (trimmedBody === "" && images.length === 0) {
    throw errors.INVALID_INPUT();
  }

  // 半端な投稿を作らない。DB に 1 行も書く前に、全部の imageId の実体を確かめる
  const imageKeys: string[] = [];
  for (const image of images) {
    const imageKey = imageKeyFor(coupleId, image.imageId);
    // 「key があれば実体がある」を保つ（architecture.md 6節）。
    // R2 の例外は画像キーを含みうるので詰め替えて投げる（withErrorId がログに出す。
    // security-requirements.md 8節）
    let head: R2Object | null;
    try {
      head = await bucket.head(imageKey);
    } catch {
      throw new Error("R2からの画像実体確認に失敗しました");
    }
    if (!head) throw errors.INVALID_INPUT();
    // サイズ・Content-Type は署名付き URL では強制できないので、ここで弾く（圧縮を経ていない・
    // 改ざんされたアップロード）。実体を残すと、この imageId で二度と投稿できない孤児になるので消す
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
  // mode="member" なら context.user は必ず非 null（auth-context.ts）。型が user と mode の
  // 対応を表せないのでアサーションで通す
  const authorName = context.user!.name;
  const authorImage = context.user!.image;

  // posts と post_images を 1 本の batch() で書く（途中で割れない）。batch は文のエラーで
  // ロールバックするので、post_images.key の UNIQUE 違反なら posts の INSERT ごと取り消される
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

// WHERE に couple_id を含めた 1 文。他ペア・存在しない・削除済みは更新 0 件で、区別せず NOT_FOUND
const postDelete = implementer.post.delete.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, coupleId } = context;

  // D1 → R2 の順（逆だと「投稿は残るのに画像が消える」が見える。architecture.md 6節）。
  // reactions・post_images も同じ batch で消し、DELETE にも couple_id の条件を EXISTS で含める
  // （無いと他ペアの投稿 ID で画像だけ消せる経路ができる）。post_images は論理削除を持たない
  // （行が残ると key の UNIQUE が塞がる）ので物理削除
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
      // 掃除の失敗で利用者の操作を失敗させない。行は消えているので、残るのは誰も辿れない孤児だけ
      // （architecture.md 6節）。画像キーはログに出さない（security-requirements.md 8節）
    }
  }

  return { id: input.id };
});

export const postProcedures = {
  list: postList,
  create: postCreate,
  delete: postDelete,
};

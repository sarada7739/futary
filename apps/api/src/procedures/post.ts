import { implementer } from "../implementer";
import { readProcedure, writeProcedure } from "./base";

const PAGE_SIZE = 20;

interface PostRow {
  id: string;
  author_id: string;
  body: string;
  image_key: string | null;
  image_width: number | null;
  image_height: number | null;
  created_at: number;
}

const POST_COLUMNS =
  "id AS id, author_id AS author_id, body AS body, image_key AS image_key, " +
  "image_width AS image_width, image_height AS image_height, created_at AS created_at";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toPost(row: PostRow) {
  return {
    id: row.id,
    authorId: row.author_id,
    body: row.body,
    imageKey: row.image_key,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    createdAt: row.created_at,
  };
}

interface Cursor {
  createdAt: number;
  id: string;
}

// カーソルは created_at と id の複合を不透明な文字列にエンコードしたもの
// （architecture.md 4節・タスク006）。同一秒に複数投稿があっても、
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
  const { db, coupleId } = context;

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
          `SELECT ${POST_COLUMNS} FROM posts
            WHERE couple_id = ?1 AND deleted_at IS NULL
              AND (created_at < ?2 OR (created_at = ?2 AND id < ?3))
            ORDER BY created_at DESC, id DESC
            LIMIT ?4`,
        )
        .bind(coupleId, cursor.createdAt, cursor.id, PAGE_SIZE + 1)
    : db
        .prepare(
          `SELECT ${POST_COLUMNS} FROM posts
            WHERE couple_id = ?1 AND deleted_at IS NULL
            ORDER BY created_at DESC, id DESC
            LIMIT ?2`,
        )
        .bind(coupleId, PAGE_SIZE + 1);

  const { results } = await stmt.all<PostRow>();

  const hasMore = results.length > PAGE_SIZE;
  const pageRows = hasMore ? results.slice(0, PAGE_SIZE) : results;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow ? encodeCursor({ createdAt: lastRow.created_at, id: lastRow.id }) : null;

  return { items: pageRows.map(toPost), nextCursor };
});

const postCreate = implementer.post.create.use(writeProcedure).handler(async ({ context, input }) => {
  const { db, coupleId, userId } = context;
  // writeProcedure が mode === 'readonly'（userId: null）を FORBIDDEN で弾いた後なので、
  // ここには到達しない。型上は CoupleContext の union のままのため、
  // 戻り値の authorId を string として返せるように絞り込む
  if (userId === null) throw new Error("writeProcedure を経由していれば到達しないはずの分岐です");
  const id = crypto.randomUUID();
  const now = nowSeconds();
  const imageKey = input.imageKey ?? null;
  const imageWidth = input.imageWidth ?? null;
  const imageHeight = input.imageHeight ?? null;

  await db
    .prepare(
      `INSERT INTO posts (id, couple_id, author_id, body, image_key, image_width, image_height, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(id, coupleId, userId, input.body, imageKey, imageWidth, imageHeight, now)
    .run();

  return {
    id,
    authorId: userId,
    body: input.body,
    imageKey,
    imageWidth,
    imageHeight,
    createdAt: now,
  };
});

// WHERE 句に couple_id = ctx.coupleId を含めて1文で行う（タスク006）。
// 他ペアの投稿ID・存在しないID・既に削除済みのIDはすべて更新件数0となり、
// 区別せず NOT_FOUND を返す
const postDelete = implementer.post.delete.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId } = context;

  const result = await db
    .prepare("UPDATE posts SET deleted_at = ?1 WHERE id = ?2 AND couple_id = ?3 AND deleted_at IS NULL")
    .bind(nowSeconds(), input.id, coupleId)
    .run();

  if (result.meta.changes === 0) throw errors.NOT_FOUND();

  return { id: input.id };
});

export const postProcedures = {
  list: postList,
  create: postCreate,
  delete: postDelete,
};

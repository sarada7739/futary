import { implementer } from "../implementer";
import { readProcedure, writeProcedure } from "./base";

// 1 ペアあたりの上限。200 に当たる利用者はまず居ない
const MAX_WISHES_PER_COUPLE = 200;

// title・note の長さは契約の Zod に置く（入力だけで判定できる条件は手続きに移さない。conventions.md 5節）

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface WishRow {
  id: string;
  title: string;
  note: string;
  done_at: number | null;
  created_at: number;
  created_by_name: string | null;
}

// created_by（ユーザー ID）は返さず、表示名だけ返す（architecture.md 5節）
function toWish(row: WishRow) {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    doneAt: row.done_at,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
  };
}

// created_by は INSERT のときだけ書く（編集しても設定者は変わらない）。今は null にならないが、
// ON DELETE が変わったときに備えて null 許容（architecture.md 5節）
async function fetchUserName(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT name AS name FROM user WHERE id = ?1`).bind(userId).first<{ name: string }>();
  return row?.name ?? null;
}

// couple_id を引数に取らない（architecture.md 5節）。未達成が先、達成済みが後で、それぞれ新しい順。
// SQLite の真偽値は 0/1 なので (done_at IS NULL) DESC で「未達成(1)が先」になる
const wishList = implementer.wish.list.use(readProcedure).handler(async ({ context }) => {
  const { db, coupleId } = context;

  const { results } = await db
    .prepare(
      `SELECT wishes.id AS id, wishes.title AS title, wishes.note AS note,
              wishes.done_at AS done_at, wishes.created_at AS created_at,
              user.name AS created_by_name
         FROM wishes LEFT JOIN user ON user.id = wishes.created_by
        WHERE wishes.couple_id = ?1 AND wishes.deleted_at IS NULL
        ORDER BY (wishes.done_at IS NULL) DESC, wishes.created_at DESC`,
    )
    .bind(coupleId)
    .all<WishRow>();

  return { items: results.map(toWish) };
});

// 上限判定（COUNT）と挿入は 2 文に分かれるので、同時に作ると数件超えうる。200 件に当たる利用者は
// まず居ないので受け入れる（件数は DB の制約 1 つでは表せない）
const wishCreate = implementer.wish.create.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, userId } = context;

  const note = input.note ?? "";

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS count FROM wishes WHERE couple_id = ?1 AND deleted_at IS NULL`)
    .bind(coupleId)
    .first<{ count: number }>();
  if ((countRow?.count ?? 0) >= MAX_WISHES_PER_COUPLE) throw errors.LIMIT_REACHED();

  const id = crypto.randomUUID();
  const now = nowSeconds();
  // mode="member" なら context.user は必ず非 null（auth-context.ts）。作成者自身への応答なので引き直さない
  const createdByName = context.user!.name;
  await db
    .prepare(
      `INSERT INTO wishes (id, couple_id, title, note, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(id, coupleId, input.title, note, userId, now)
    .run();

  return toWish({ id, title: input.title, note, done_at: null, created_at: now, created_by_name: createdByName });
});

// 消して入れ直すとチェック・作成日・設定者が失われるので、更新を持つ（028）。
// 渡されなかった項目は変えない（COALESCE）。created_by は変えない。作成者に限定しない
const wishUpdate = implementer.wish.update.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId } = context;

  const row = await db
    .prepare(
      `UPDATE wishes
          SET title = COALESCE(?1, title), note = COALESCE(?2, note)
        WHERE id = ?3 AND couple_id = ?4 AND deleted_at IS NULL
       RETURNING id AS id, title AS title, note AS note, done_at AS done_at,
                 created_at AS created_at, created_by AS created_by`,
    )
    .bind(input.title ?? null, input.note ?? null, input.id, coupleId)
    .first<Omit<WishRow, "created_by_name"> & { created_by: string }>();

  if (!row) throw errors.NOT_FOUND();
  const createdByName = await fetchUserName(db, row.created_by);
  return toWish({ ...row, created_by_name: createdByName });
});

// toggle でなく目標の状態を送る（冪等）。既に達成済みの行に done:true を送っても元の done_at を保つ（COALESCE）。
// WHERE に couple_id を含めた 1 文で、更新 0 件は区別せず NOT_FOUND（存在を教えない）
const wishSetDone = implementer.wish.setDone.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId } = context;

  const row = await db
    .prepare(
      `UPDATE wishes
          SET done_at = CASE WHEN ?1 THEN COALESCE(done_at, ?2) ELSE NULL END
        WHERE id = ?3 AND couple_id = ?4 AND deleted_at IS NULL
       RETURNING id AS id, title AS title, note AS note, done_at AS done_at,
                 created_at AS created_at, created_by AS created_by`,
    )
    .bind(input.done ? 1 : 0, nowSeconds(), input.id, coupleId)
    .first<Omit<WishRow, "created_by_name"> & { created_by: string }>();

  if (!row) throw errors.NOT_FOUND();
  const createdByName = await fetchUserName(db, row.created_by);
  return toWish({ ...row, created_by_name: createdByName });
});

// 論理削除（architecture.md 4節）。WHERE に couple_id を含めた 1 文。ペアのどちらでも消せる
const wishDelete = implementer.wish.delete.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId } = context;

  const row = await db
    .prepare(
      `UPDATE wishes SET deleted_at = ?1
        WHERE id = ?2 AND couple_id = ?3 AND deleted_at IS NULL
       RETURNING id AS id`,
    )
    .bind(nowSeconds(), input.id, coupleId)
    .first<{ id: string }>();

  if (!row) throw errors.NOT_FOUND();
  return { id: row.id };
});

export const wishProcedures = {
  list: wishList,
  create: wishCreate,
  update: wishUpdate,
  setDone: wishSetDone,
  delete: wishDelete,
};

import { implementer } from "../implementer";
import { readProcedure, writeProcedure } from "./base";

// タスク定義5節: 1ペアあたりの上限。200に当たる利用者はまず居ない
const MAX_WISHES_PER_COUPLE = 200;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface WishRow {
  id: string;
  title: string;
  done_at: number | null;
  created_at: number;
}

// createdByは返さない（レスポンスに含めない列。architecture.md 5節）
function toWish(row: WishRow) {
  return { id: row.id, title: row.title, doneAt: row.done_at, createdAt: row.created_at };
}

// ctx.coupleIdのみを使い、couple_idを引数に取らない（architecture.md 5節）。
// 未達成が先、達成済みが後。それぞれcreated_atの新しい順（タスク定義8節）。
// SQLiteの真偽値は0/1として比較できるため、(done_at IS NULL)をDESCで
// 並べるだけで「未達成(1)が先、達成済み(0)が後」になる
const wishList = implementer.wish.list.use(readProcedure).handler(async ({ context }) => {
  const { db, coupleId } = context;

  const { results } = await db
    .prepare(
      `SELECT id AS id, title AS title, done_at AS done_at, created_at AS created_at
         FROM wishes
        WHERE couple_id = ?1 AND deleted_at IS NULL
        ORDER BY (done_at IS NULL) DESC, created_at DESC`,
    )
    .bind(coupleId)
    .all<WishRow>();

  return { items: results.map(toWish) };
});

// 上限判定（COUNT）と挿入は2文に分かれる。同時に201件目のリクエストが競合すると
// 上限を数件超える可能性はあるが、1ペア200件に実際に当たる利用者はまず居らず
// （タスク定義5節）、実害は小さいと判断した（部分UNIQUEインデックスで機械的に
// 防げる会った日の一意化とは性質が異なり、「件数」はDBの制約1つでは表せない）
const wishCreate = implementer.wish.create.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, userId } = context;

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS count FROM wishes WHERE couple_id = ?1 AND deleted_at IS NULL`)
    .bind(coupleId)
    .first<{ count: number }>();
  if ((countRow?.count ?? 0) >= MAX_WISHES_PER_COUPLE) throw errors.LIMIT_REACHED();

  const id = crypto.randomUUID();
  const now = nowSeconds();
  // input.titleは契約のtitleSchema（trim済み）を通過済み
  await db
    .prepare(`INSERT INTO wishes (id, couple_id, title, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(id, coupleId, input.title, userId, now)
    .run();

  return toWish({ id, title: input.title, done_at: null, created_at: now });
});

// toggleではなくsetDone: クライアントが目標の状態(done)を送る。同じdoneを
// 2回送っても結果が変わらない（冪等）ようにするため、既にdone_atが立っている
// 行にdone:trueを送っても元のdone_atを保つ（COALESCE。タスク定義3節）。
// WHERE句にcouple_idを含めた1文で行う（006のpost.deleteと同じ形）。
// 他ペアのid・存在しないid・削除済みのidはすべて更新件数0となり、
// 区別せずNOT_FOUNDを返す（存在を教えない。タスク定義8節）
const wishSetDone = implementer.wish.setDone.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId } = context;

  const row = await db
    .prepare(
      `UPDATE wishes
          SET done_at = CASE WHEN ?1 THEN COALESCE(done_at, ?2) ELSE NULL END
        WHERE id = ?3 AND couple_id = ?4 AND deleted_at IS NULL
       RETURNING id AS id, title AS title, done_at AS done_at, created_at AS created_at`,
    )
    .bind(input.done ? 1 : 0, nowSeconds(), input.id, coupleId)
    .first<WishRow>();

  if (!row) throw errors.NOT_FOUND();
  return toWish(row);
});

// 論理削除（postsと同じ規則。architecture.md 4節）。WHERE句にcouple_idを
// 含めた1文で行う。作成者に限定しない。ペアのどちらでも削除できる
// （タスク定義4節。021のplan持ち主の仕組みはここには持ち込まない）
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
  setDone: wishSetDone,
  delete: wishDelete,
};

import { MAX_WISH_NOTE_LENGTH, MAX_WISH_TITLE_LENGTH } from "@futary/contract";
import { implementer } from "../implementer";
import { readProcedure, writeProcedure } from "./base";

// タスク定義5節: 1ペアあたりの上限。200に当たる利用者はまず居ない
const MAX_WISHES_PER_COUPLE = 200;

// 契約の`.input()`（Zod）はtrimだけを行い、長さの下限・上限はここで判定する。
// oRPCの`validateInput`はZodスキーマのバリデーション失敗を常にBAD_REQUESTとして
// 返し、契約の`.errors()`で宣言したINVALID_INPUTにはマッピングしない
// （@orpc/serverの実装で確認済み）。タスク定義がINVALID_INPUTを明示している
// ため、ここで明示的に検証してINVALID_INPUTとして返す
// errorsの型はhandlerごとにoRPCが生成するため、INVALID_INPUT()の戻り値型
// （ORPCError<...>）を厳密に固定せず、共変な形（unknownを返す関数）で
// 受け取る
function assertValidTitle(title: string, errors: { INVALID_INPUT: () => unknown }): void {
  if (title.length < 1 || title.length > MAX_WISH_TITLE_LENGTH) throw errors.INVALID_INPUT();
}
function assertValidNote(note: string, errors: { INVALID_INPUT: () => unknown }): void {
  if (note.length > MAX_WISH_NOTE_LENGTH) throw errors.INVALID_INPUT();
}

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

// created_by（ユーザーID）は返さない。createdByName（表示名）だけ返す
// （028。event.createdByNameと同じ形。architecture.md 5節）
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

// 028: created_byはINSERT時にしか書かない（設定者は編集しても変わらない。
// event.createdByと同じくuser(id)への外部キー。ON DELETE no actionのため
// nullになる状態は現状作れないが、将来に備えnull許容で扱う。posts.authorNameと
// 同じ判断。architecture.md 5節）
async function fetchUserName(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT name AS name FROM user WHERE id = ?1`).bind(userId).first<{ name: string }>();
  return row?.name ?? null;
}

// ctx.coupleIdのみを使い、couple_idを引数に取らない（architecture.md 5節）。
// 未達成が先、達成済みが後。それぞれcreated_atの新しい順（タスク定義8節）。
// SQLiteの真偽値は0/1として比較できるため、(done_at IS NULL)をDESCで
// 並べるだけで「未達成(1)が先、達成済み(0)が後」になる。
// 設定者の名前を出すためuserをLEFT JOINする（028・architecture.md 5節。
// posts.authorNameと同じ形）
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

// 上限判定（COUNT）と挿入は2文に分かれる。同時に201件目のリクエストが競合すると
// 上限を数件超える可能性はあるが、1ペア200件に実際に当たる利用者はまず居らず
// （タスク定義5節）、実害は小さいと判断した（部分UNIQUEインデックスで機械的に
// 防げる会った日の一意化とは性質が異なり、「件数」はDBの制約1つでは表せない）
const wishCreate = implementer.wish.create.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, userId } = context;

  // 【security-auditor指摘】安く拒否できるものを先に拒否する。D1へのCOUNT
  // クエリより前に入力の形を確認し、不正な入力ではD1を叩かないようにする
  // （wish.updateと検証の順序を揃える）
  const note = input.note ?? "";
  assertValidTitle(input.title, errors);
  assertValidNote(note, errors);

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS count FROM wishes WHERE couple_id = ?1 AND deleted_at IS NULL`)
    .bind(coupleId)
    .first<{ count: number }>();
  if ((countRow?.count ?? 0) >= MAX_WISHES_PER_COUPLE) throw errors.LIMIT_REACHED();

  const id = crypto.randomUUID();
  const now = nowSeconds();
  // context.userはresolveCoupleContextがmode="member"を返した時点で必ず
  // 非null（base.ts冒頭コメント参照）。作成者自身の応答なので名前を引き直す
  // 必要はない
  const createdByName = context.user!.name;
  // input.titleは契約のtitleSchema（trim済み）を通過し、上でassertValidTitle済み
  await db
    .prepare(
      `INSERT INTO wishes (id, couple_id, title, note, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(id, coupleId, input.title, note, userId, now)
    .run();

  return toWish({ id, title: input.title, note, done_at: null, created_at: now, created_by_name: createdByName });
});

// 028: メモを足したことで「消して入れ直す」が成り立たなくなったため新設
// （チェック状態・created_at・設定者が失われるため。タスク定義4節）。
// 渡されなかった項目は変えない（COALESCE。undefinedはnullとしてbindする）。
// created_byは更新しない（設定者は編集しても変わらない。タスク定義1節）。
// WHERE句にcouple_idを含めた1文で行う。作成者に限定しない
// （021のplan持ち主の仕組みはここには持ち込まない。タスク定義2節）
const wishUpdate = implementer.wish.update.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId } = context;

  if (input.title !== undefined) assertValidTitle(input.title, errors);
  if (input.note !== undefined) assertValidNote(input.note, errors);

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
       RETURNING id AS id, title AS title, note AS note, done_at AS done_at,
                 created_at AS created_at, created_by AS created_by`,
    )
    .bind(input.done ? 1 : 0, nowSeconds(), input.id, coupleId)
    .first<Omit<WishRow, "created_by_name"> & { created_by: string }>();

  if (!row) throw errors.NOT_FOUND();
  const createdByName = await fetchUserName(db, row.created_by);
  return toWish({ ...row, created_by_name: createdByName });
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
  update: wishUpdate,
  setDone: wishSetDone,
  delete: wishDelete,
};

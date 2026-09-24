import type { Event } from "@futary/contract";
import { implementer } from "../implementer";
import { diffDays, monthDayOf, projectMonthDay, yearsBetween } from "@futary/date";
import { isConstraintViolation } from "./couple";
import { readProcedure, writeProcedure } from "./base";

// 範囲は最大 400 日（射影の回数と D1 の読み取りを有界にする。月グリッド 42 日・年 366 日を覆う。architecture.md 5節）
const MAX_RANGE_DAYS = 400;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface EventRowBase {
  id: string;
  date: string;
  title: string;
  kind: string;
  repeat_yearly: number;
  start_time: string | null;
  end_time: string | null;
  is_shared: number;
}

// create/update は RETURNING に JOIN を書けないので、名前は別に引いて合わせる
interface EventRow extends EventRowBase {
  created_by_name: string | null;
  created_by: string;
}

// plan にだけ行ごとの持ち主がある（記念日・会った日はどちらでも編集できる）。update/delete の
// WHERE と同じ規則で、両方が同じ答えを出すことをテストで突き合わせる（021）。
// viewerId が null（デモ閲覧）は writeProcedure が弾くので常に false
function computeCanEdit(kind: string, isShared: boolean, createdBy: string, viewerId: string | null): boolean {
  if (viewerId === null) return false;
  return kind !== "plan" || isShared || createdBy === viewerId;
}

// createdById は返さず、サーバが計算した canEdit だけを返す（権限規則をクライアントに書かせない。
// architecture.md 5節）
function toEvent(row: EventRowBase, createdByName: string | null, canEdit: boolean): Event {
  return {
    id: row.id,
    date: row.date,
    sourceDate: row.date,
    title: row.title,
    kind: row.kind as Event["kind"],
    repeatYearly: row.repeat_yearly === 1,
    startTime: row.start_time,
    endTime: row.end_time,
    createdByName,
    isShared: row.is_shared === 1,
    canEdit,
  };
}

// 今は到達しないが、ON DELETE が変わったときに予定を黙って消さないよう null 許容（architecture.md 5節）
async function fetchUserName(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT name AS name FROM user WHERE id = ?1`).bind(userId).first<{ name: string }>();
  return row?.name ?? null;
}

// repeat_yearly=1 の行を範囲が触れる年それぞれに射影する（年を決め打ちにしない。architecture.md 5節）。
// 同じ記念日が 2 回現れうるが、重複は除かない
function projectEvent(row: EventRow, from: string, to: string, viewerId: string | null): Event[] {
  const canEdit = computeCanEdit(row.kind, row.is_shared === 1, row.created_by, viewerId);
  const event = toEvent(row, row.created_by_name, canEdit);
  if (!event.repeatYearly) return [event];

  const { month, day } = monthDayOf(row.date);
  return yearsBetween(from, to)
    .map((year) => projectMonthDay(month, day, year))
    .filter((date) => date >= from && date <= to)
    .map((date) => ({ ...event, date }));
}

// couple_id を引数に取らない（architecture.md 5節）
const eventList = implementer.event.list.use(readProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, userId } = context;

  const rangeDays = diffDays(input.from, input.to);
  if (rangeDays < 0 || rangeDays > MAX_RANGE_DAYS) {
    throw errors.INVALID_INPUT();
  }

  // repeat_yearly=0 は SQL で範囲に絞る。=1 は登録した年に関わらず出うるので全件を取ってから射影する。
  // created_by は canEdit の計算にだけ使い、応答に含めない
  const { results } = await db
    .prepare(
      `SELECT events.id AS id, events.date AS date, events.title AS title, events.kind AS kind,
              events.repeat_yearly AS repeat_yearly, events.start_time AS start_time,
              events.end_time AS end_time, events.is_shared AS is_shared,
              events.created_by AS created_by, user.name AS created_by_name
         FROM events LEFT JOIN user ON user.id = events.created_by
        WHERE events.couple_id = ?1
          AND ((events.repeat_yearly = 0 AND events.date >= ?2 AND events.date <= ?3) OR events.repeat_yearly = 1)`,
    )
    .bind(coupleId, input.from, input.to)
    .all<EventRow>();

  const items = results.flatMap((row) => projectEvent(row, input.from, input.to, userId));
  return { items };
});

const eventCreate = implementer.event.create.use(writeProcedure).handler(async ({ context, input }) => {
  const { db, coupleId, userId } = context;
  const id = crypto.randomUUID();
  const repeatYearly = input.repeatYearly ? 1 : 0;
  const startTime = input.startTime ?? null;
  const endTime = input.endTime ?? null;
  const isShared = input.isShared ? 1 : 0;
  // mode="member" なら context.user は必ず非 null（auth-context.ts）
  const createdByName = context.user!.name;

  // meetup だけが events_meetup_unique（couple_id, date の部分 UNIQUE）にぶつかりうる。
  // D1 にトランザクションが無いので、SELECT してから UPDATE にせず ON CONFLICT DO UPDATE の 1 文で上書きする
  // （security-requirements.md 3節）。id は変えない（既存行の身元を保つ）。
  // SET に end_time も含める（忘れると前の終了時刻が残る）
  const row = await db
    .prepare(
      `INSERT INTO events (id, couple_id, date, title, kind, repeat_yearly, start_time, end_time, created_by, is_shared, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT (couple_id, date) WHERE kind = 'meetup' DO UPDATE SET
         title = excluded.title,
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         created_by = excluded.created_by,
         created_at = excluded.created_at
       RETURNING id AS id, date AS date, title AS title, kind AS kind,
                 repeat_yearly AS repeat_yearly, start_time AS start_time, end_time AS end_time,
                 is_shared AS is_shared`,
    )
    .bind(
      id,
      coupleId,
      input.date,
      input.title,
      input.kind,
      repeatYearly,
      startTime,
      endTime,
      userId,
      isShared,
      nowSeconds(),
    )
    .first<EventRowBase>();

  // 作成者自身への応答なので常に編集できる
  return toEvent(row!, createdByName, true);
});

// WHERE に couple_id と権限規則を含めた 1 文。他ペア・存在しない・権限が無いは更新 0 件で、
// 区別せず NOT_FOUND（0 件のあとに理由を調べない）。
//
// WHERE の 3 つの条件（security-requirements.md 3節項目8）:
// (1) 更新前の行に対する権限。event.delete と文言をそろえる（片方だけ変えると消せてしまう）
// (2) 更新後も実行者自身が編集できること。無いと、設定者でない側が記念日を plan・非共有に
//     変えて自分を締め出せる
// (3) plan 以外 → plan への変換そのものを拒む。(2) だけだと設定者本人は通り、記念日を
//     非共有の plan に変えて相手を締め出せる（「共有 plan にする → 非共有にする」の 2 段階でも着く）。
// plan の中の共有・非共有は持ち主が決めてよい。削除には「更新後」が無いので (2)(3) は要らない
const eventUpdate = implementer.event.update.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, userId } = context;
  const repeatYearly = input.repeatYearly ? 1 : 0;
  const startTime = input.startTime ?? null;
  const endTime = input.endTime ?? null;
  const isShared = input.isShared ? 1 : 0;

  let row: (EventRowBase & { created_by: string }) | null;
  try {
    row = await db
      .prepare(
        `UPDATE events
            SET date = ?1, title = ?2, kind = ?3, repeat_yearly = ?4, start_time = ?5, end_time = ?6, is_shared = ?7
          WHERE id = ?8 AND couple_id = ?9
            AND (kind <> 'plan' OR is_shared = 1 OR created_by = ?10)
            AND (?3 <> 'plan' OR ?7 = 1 OR created_by = ?10)
            AND NOT (kind <> 'plan' AND ?3 = 'plan')
         RETURNING id AS id, date AS date, title AS title, kind AS kind,
                   repeat_yearly AS repeat_yearly, start_time AS start_time, end_time AS end_time,
                   is_shared AS is_shared, created_by AS created_by`,
      )
      .bind(
        input.date,
        input.title,
        input.kind,
        repeatYearly,
        startTime,
        endTime,
        isShared,
        input.id,
        coupleId,
        userId,
      )
      .first<EventRowBase & { created_by: string }>();
  } catch (error) {
    // その日に別の「会った日」がある。update は create と違い上書きしない
    // （別の行が黙って消えるのは利用者の意図と違う。architecture.md 5節）
    if (isConstraintViolation(error)) throw errors.INVALID_INPUT();
    throw error;
  }

  if (!row) throw errors.NOT_FOUND();
  const createdByName = await fetchUserName(db, row.created_by);
  const canEdit = computeCanEdit(row.kind, row.is_shared === 1, row.created_by, userId);
  return toEvent(row, createdByName, canEdit);
});

// 権限規則は event.update の (1) と文言をそろえる（片方だけ変えると消せてしまう）
const eventDelete = implementer.event.delete.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, userId } = context;

  const row = await db
    .prepare(
      `DELETE FROM events
        WHERE id = ?1 AND couple_id = ?2
          AND (kind <> 'plan' OR is_shared = 1 OR created_by = ?3)
      RETURNING id AS id`,
    )
    .bind(input.id, coupleId, userId)
    .first<{ id: string }>();

  if (!row) throw errors.NOT_FOUND();
  return { id: row.id };
});

export const eventProcedures = {
  list: eventList,
  create: eventCreate,
  update: eventUpdate,
  delete: eventDelete,
};

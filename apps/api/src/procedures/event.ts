import type { Event } from "@futary/contract";
import { implementer } from "../implementer";
import { diffDays, monthDayOf, projectMonthDay, yearsBetween } from "@futary/date";
import { readProcedure, writeProcedure } from "./base";

// 範囲は最大400日。射影の回数と D1 の行読み取りを有界にする。
// 月グリッド（最大42日）と年表示（366日）を十分に覆う（architecture.md 5節）
const MAX_RANGE_DAYS = 400;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface EventRow {
  id: string;
  date: string;
  title: string;
  kind: string;
  repeat_yearly: number;
}

// repeat_yearly=0 のときは date === sourceDate（射影が起きていない）
function toEvent(row: EventRow): Event {
  return {
    id: row.id,
    date: row.date,
    sourceDate: row.date,
    title: row.title,
    kind: row.kind as Event["kind"],
    repeatYearly: row.repeat_yearly === 1,
  };
}

// repeat_yearly=1 の行を、範囲が触れる年それぞれに射影する（architecture.md 5節）。
// 「射影する年を決め打ちにしない」ため year(from)〜year(to) を必ずループする。
// 同じ記念日が2回現れることがあり、重複は除去しない
function projectEvent(row: EventRow, from: string, to: string): Event[] {
  const event = toEvent(row);
  if (!event.repeatYearly) return [event];

  const { month, day } = monthDayOf(row.date);
  return yearsBetween(from, to)
    .map((year) => projectMonthDay(month, day, year))
    .filter((date) => date >= from && date <= to)
    .map((date) => ({ ...event, date }));
}

// ctx.coupleId のみを使い、couple_id を引数に取らない（architecture.md 5節）
const eventList = implementer.event.list.use(readProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId } = context;

  const rangeDays = diffDays(input.from, input.to);
  if (rangeDays < 0 || rangeDays > MAX_RANGE_DAYS) {
    throw errors.INVALID_INPUT();
  }

  // repeat_yearly=0 は SQL 側で範囲に絞る。repeat_yearly=1 はこの couple の
  // 全件を取ってから射影する（登録された年に関わらず表示されうるため、
  // date 列の範囲条件では絞れない）
  const { results } = await db
    .prepare(
      `SELECT id AS id, date AS date, title AS title, kind AS kind, repeat_yearly AS repeat_yearly
         FROM events
        WHERE couple_id = ?1
          AND ((repeat_yearly = 0 AND date >= ?2 AND date <= ?3) OR repeat_yearly = 1)`,
    )
    .bind(coupleId, input.from, input.to)
    .all<EventRow>();

  const items = results.flatMap((row) => projectEvent(row, input.from, input.to));
  return { items };
});

const eventCreate = implementer.event.create.use(writeProcedure).handler(async ({ context, input }) => {
  const { db, coupleId, userId } = context;
  const id = crypto.randomUUID();
  const repeatYearly = input.repeatYearly ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO events (id, couple_id, date, title, kind, repeat_yearly, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(id, coupleId, input.date, input.title, input.kind, repeatYearly, userId, nowSeconds())
    .run();

  return toEvent({ id, date: input.date, title: input.title, kind: input.kind, repeat_yearly: repeatYearly });
});

// WHERE 句に couple_id = ctx.coupleId を含めて1文で行う（006の post.delete と同じ形）。
// 他ペアのイベントID・存在しないIDはどちらも更新件数0となり、区別せず NOT_FOUND を返す
const eventUpdate = implementer.event.update.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId } = context;
  const repeatYearly = input.repeatYearly ? 1 : 0;

  const row = await db
    .prepare(
      `UPDATE events
          SET date = ?1, title = ?2, kind = ?3, repeat_yearly = ?4
        WHERE id = ?5 AND couple_id = ?6
       RETURNING id AS id, date AS date, title AS title, kind AS kind, repeat_yearly AS repeat_yearly`,
    )
    .bind(input.date, input.title, input.kind, repeatYearly, input.id, coupleId)
    .first<EventRow>();

  if (!row) throw errors.NOT_FOUND();
  return toEvent(row);
});

const eventDelete = implementer.event.delete.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId } = context;

  const row = await db
    .prepare(`DELETE FROM events WHERE id = ?1 AND couple_id = ?2 RETURNING id AS id`)
    .bind(input.id, coupleId)
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

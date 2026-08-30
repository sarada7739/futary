import type { Event } from "@futary/contract";
import { implementer } from "../implementer";
import { diffDays, monthDayOf, projectMonthDay, yearsBetween } from "@futary/date";
import { isConstraintViolation } from "./couple";
import { readProcedure, writeProcedure } from "./base";

// 範囲は最大400日。射影の回数と D1 の行読み取りを有界にする。
// 月グリッド（最大42日）と年表示（366日）を十分に覆う（architecture.md 5節）
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
  time: string | null;
}

// event.list は user を LEFT JOIN して1クエリで取れるが、event.create/update は
// INSERT/UPDATE の RETURNING に JOIN を書けないため、名前は別途合成する（下記参照）
interface EventRow extends EventRowBase {
  created_by_name: string | null;
}

// repeat_yearly=0 のときは date === sourceDate（射影が起きていない）
function toEvent(row: EventRowBase, createdByName: string | null): Event {
  return {
    id: row.id,
    date: row.date,
    sourceDate: row.date,
    title: row.title,
    kind: row.kind as Event["kind"],
    repeatYearly: row.repeat_yearly === 1,
    time: row.time,
    createdByName,
  };
}

// created_by は user(id) への外部キー（ON DELETE no action）。到達不能な状態は
// 現状作れないが、将来 ON DELETE が変わったときに予定を黙って消さないよう
// null 許容にする（posts.authorName と同じ判断。architecture.md 5節）
async function fetchUserName(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT name AS name FROM user WHERE id = ?1`).bind(userId).first<{ name: string }>();
  return row?.name ?? null;
}

// repeat_yearly=1 の行を、範囲が触れる年それぞれに射影する（architecture.md 5節）。
// 「射影する年を決め打ちにしない」ため year(from)〜year(to) を必ずループする。
// 同じ記念日が2回現れることがあり、重複は除去しない
function projectEvent(row: EventRow, from: string, to: string): Event[] {
  const event = toEvent(row, row.created_by_name);
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
  // date 列の範囲条件では絞れない）。設定者の名前を出すため user を LEFT JOIN
  // する（018・architecture.md 5節。posts.authorName と同じ形）
  const { results } = await db
    .prepare(
      `SELECT events.id AS id, events.date AS date, events.title AS title, events.kind AS kind,
              events.repeat_yearly AS repeat_yearly, events.time AS time,
              user.name AS created_by_name
         FROM events LEFT JOIN user ON user.id = events.created_by
        WHERE events.couple_id = ?1
          AND ((events.repeat_yearly = 0 AND events.date >= ?2 AND events.date <= ?3) OR events.repeat_yearly = 1)`,
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
  const time = input.time ?? null;
  // context.user は resolveCoupleContext が mode="member" を返した時点で必ず
  // 非null（post.ts と同じ理由。base.ts冒頭コメント参照）
  const createdByName = context.user!.name;

  // kind='meetup' のときだけ events_meetup_unique（couple_id, date の部分UNIQUE。
  // architecture.md 5節）にぶつかりうる。ON CONFLICT DO UPDATE で1文のまま上書きする
  // （「SELECTしてからUPDATE」の2段階にしない。security-requirements.md 3節・
  // D1にインタラクティブなトランザクションが無いため）。id は更新しない
  // （既存行の身元を保つ。他のkindでは対応する部分インデックスの対象外のため
  // このON CONFLICT句自体が発火しない）
  const row = await db
    .prepare(
      `INSERT INTO events (id, couple_id, date, title, kind, repeat_yearly, time, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (couple_id, date) WHERE kind = 'meetup' DO UPDATE SET
         title = excluded.title,
         time = excluded.time,
         created_by = excluded.created_by,
         created_at = excluded.created_at
       RETURNING id AS id, date AS date, title AS title, kind AS kind,
                 repeat_yearly AS repeat_yearly, time AS time`,
    )
    .bind(id, coupleId, input.date, input.title, input.kind, repeatYearly, time, userId, nowSeconds())
    .first<EventRowBase>();

  return toEvent(row!, createdByName);
});

// WHERE 句に couple_id = ctx.coupleId を含めて1文で行う（006の post.delete と同じ形）。
// 他ペアのイベントID・存在しないIDはどちらも更新件数0となり、区別せず NOT_FOUND を返す
const eventUpdate = implementer.event.update.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId } = context;
  const repeatYearly = input.repeatYearly ? 1 : 0;
  const time = input.time ?? null;

  let row: (EventRowBase & { created_by: string }) | null;
  try {
    row = await db
      .prepare(
        `UPDATE events
            SET date = ?1, title = ?2, kind = ?3, repeat_yearly = ?4, time = ?5
          WHERE id = ?6 AND couple_id = ?7
         RETURNING id AS id, date AS date, title AS title, kind AS kind,
                   repeat_yearly AS repeat_yearly, time AS time, created_by AS created_by`,
      )
      .bind(input.date, input.title, input.kind, repeatYearly, time, input.id, coupleId)
      .first<EventRowBase & { created_by: string }>();
  } catch (error) {
    // events_meetup_unique 違反 = その日には既に別の「会った日」がある。
    // update は create と違い上書きしない。「別の行が黙って消える」のは
    // 利用者の意図と違うため（018・architecture.md 5節）
    if (isConstraintViolation(error)) throw errors.INVALID_INPUT();
    throw error;
  }

  if (!row) throw errors.NOT_FOUND();
  const createdByName = await fetchUserName(db, row.created_by);
  return toEvent(row, createdByName);
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

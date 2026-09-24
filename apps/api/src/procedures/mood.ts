import { diffDays, todayJst } from "@futary/date";
import { implementer } from "../implementer";
import { readProcedure, writeProcedure } from "./base";

// event.list と同じ数に揃える
const MAX_RANGE_DAYS = 400;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface MoodRow {
  user_id: string;
  date: string;
  level: number;
}

interface MemberRow {
  user_id: string;
  name: string | null;
}

function toEntry(row: MoodRow) {
  return { date: row.date, level: row.level };
}

// user_id を引数に取らない（渡せないものは間違えて渡せない）。今日の日付はサーバが決める
// （クライアントから日付を受け取らないので「今日の分しか記録できない」が構造で決まる）。
// (couple_id, user_id, date) への ON CONFLICT DO UPDATE の 1 文で upsert する
const moodSetToday = implementer.mood.setToday.use(writeProcedure).handler(async ({ context, input }) => {
  const { db, coupleId, userId } = context;
  const date = todayJst();
  const now = nowSeconds();

  await db
    .prepare(
      `INSERT INTO moods (couple_id, user_id, date, level, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (couple_id, user_id, date) DO UPDATE SET
         level = excluded.level,
         updated_at = excluded.updated_at`,
    )
    .bind(coupleId, userId, date, input.level, now)
    .run();

  return { date, level: input.level };
});

// 物理削除（requirements.md 6節の例外）。無い日に呼んでも同じ {date} を返す（冪等）
const moodClearToday = implementer.mood.clearToday.use(writeProcedure).handler(async ({ context }) => {
  const { db, coupleId, userId } = context;
  const date = todayJst();

  await db
    .prepare(`DELETE FROM moods WHERE couple_id = ?1 AND user_id = ?2 AND date = ?3`)
    .bind(coupleId, userId, date)
    .run();

  return { date };
});

// mine と partner を分けて返す（1 本の配列に userId を混ぜない）。デモ（userId が null）は「自分」を
// 決める手がかりが無いので、slot 順で 1 人目を mine・2 人目を partner にする（ふたり分が見える方が大事）。
// 相手が未参加なら partner は null
const moodList = implementer.mood.list.use(readProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, userId } = context;

  const rangeDays = diffDays(input.from, input.to);
  if (rangeDays < 0 || rangeDays > MAX_RANGE_DAYS) {
    throw errors.INVALID_INPUT();
  }

  const [membersResult, moodsResult] = await Promise.all([
    db
      .prepare(
        `SELECT couple_members.user_id AS user_id, user.name AS name
           FROM couple_members LEFT JOIN user ON user.id = couple_members.user_id
          WHERE couple_members.couple_id = ?1
          ORDER BY couple_members.slot`,
      )
      .bind(coupleId)
      .all<MemberRow>(),
    db
      .prepare(
        `SELECT user_id AS user_id, date AS date, level AS level
           FROM moods
          WHERE couple_id = ?1 AND date >= ?2 AND date <= ?3`,
      )
      .bind(coupleId, input.from, input.to)
      .all<MoodRow>(),
  ]);

  const members = membersResult.results;
  const mineUserId = userId ?? members[0]?.user_id ?? null;
  const partnerMember = members.find((m) => m.user_id !== mineUserId) ?? null;

  const mine = mineUserId
    ? moodsResult.results.filter((row) => row.user_id === mineUserId).map(toEntry)
    : [];
  const partnerItems = partnerMember
    ? moodsResult.results.filter((row) => row.user_id === partnerMember.user_id).map(toEntry)
    : [];

  return {
    mine,
    partner: partnerMember ? { name: partnerMember.name, items: partnerItems } : null,
  };
});

export const moodProcedures = {
  setToday: moodSetToday,
  clearToday: moodClearToday,
  list: moodList,
};

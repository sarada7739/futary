import { diffDays, todayJst } from "@futary/date";
import { implementer } from "../implementer";
import { readProcedure, writeProcedure } from "./base";

// タスク定義9節: event.listと同じ数に揃える（conventions.md 5節
// 「線に合っていないもの」に記載。DBを読まないと分からない条件ではないが、
// event.listと同じ場所に置く）
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

// user_idを引数に取らない。ctx.userIdのみを使う（タスク定義6節「渡せない
// ものは、間違えて渡せない」）。今日の日付はサーバ側で計算する
// （todayJst()。クライアントから日付を受け取らないことで「今日の分しか
// 記録できない」を構造的に担保する。タスク定義5節）。
// 複合主キー（couple_id, user_id, date）へのON CONFLICT DO UPDATEで
// upsertする（1文。event.tsのmeetup一意化と同じ形）
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

// 物理削除（requirements.md 6節の例外。タスク定義7節）。無い日に呼んでも
// 冪等に同じ{date}を返す（削除対象が無いだけで、エラーにする理由が無い）
const moodClearToday = implementer.mood.clearToday.use(writeProcedure).handler(async ({ context }) => {
  const { db, coupleId, userId } = context;
  const date = todayJst();

  await db
    .prepare(`DELETE FROM moods WHERE couple_id = ?1 AND user_id = ?2 AND date = ?3`)
    .bind(coupleId, userId, date)
    .run();

  return { date };
});

// mine/partnerを分けて返す（タスク定義9節。1本の配列にuserIdを混ぜない）。
// 未認証（デモ。userIdがnull）の場合、「自分」を特定する手がかりが無いため、
// couple_membersのslot順で決定的に1人目をmine・2人目をpartnerとして扱う
// （他のreadProcedureがデモペアの全データを見せるのと同じ考え方。
// どちらが「わたし」表示になっても実害はなく、ふたり分が見えることの方が
// デモ体験として重要）。相手が未参加（ペアが1人）ならpartnerはnull
// （タスク定義11節）
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

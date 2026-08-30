import type { DaysTogether } from "@futary/contract";
import { diffDays, todayJst } from "@futary/date";
import { implementer } from "../implementer";
import { resolveUserImage } from "../lib/r2-signed-url";
import { readProcedure } from "./base";

interface CoupleDatesRow {
  dating_date: string | null;
  married_date: string | null;
  primary_date: string;
}

interface MemberRow {
  user_id: string;
  name: string | null;
  image: string | null;
}

interface CountRow {
  count: number;
}

// 019: couples.primary_date（'dating'/'married'/'none'）に従って daysTogether を
// 出し分ける。記念日当日を1日目とする（境界条件。docs/tasks/012-stats-card.md）。
// 未来の日付なら「あと○日」を返す（人間の決定。state.md L66）。
// 「負の値を出さない」責任はここ（サーバ側）で閉じる。
// dating/married それぞれに upcoming の対を持たせる（Aの決定・PR #123。
// 「結婚まであと○日」も主役になりうる数字であり、married_upcomingが無いと
// dating側だけが修飾された非対称な名前になる）。
//
// 023: primary_dateが指している方の日付がまだ無いとき'unset'を返す
// （登録時に付き合った日を聞かなくなったため生じる状態。「まだ決めていない」を
// 'hidden'〈本人が隠すと決めた〉と分ける。「片方の日付があるから、そっちを
// 出す」はしない。利用者が選んだ方だけを見る）
export function computeDaysTogether(couple: CoupleDatesRow, today: string): DaysTogether {
  if (couple.primary_date === "none") return { status: "hidden" };

  if (couple.primary_date === "married") {
    if (couple.married_date === null) return { status: "unset" };
    const diff = diffDays(couple.married_date, today);
    if (diff >= 0) return { status: "married", days: diff + 1 };
    return { status: "married_upcoming", days: -diff };
  }

  if (couple.dating_date === null) return { status: "unset" };
  const diff = diffDays(couple.dating_date, today);
  if (diff >= 0) return { status: "dating", days: diff + 1 };
  return { status: "dating_upcoming", days: -diff };
}

// stats.get は専用テーブルを持たず、既存テーブルから算出する（architecture.md 4節）。
// ctx.coupleId のみを使い、couple_id を引数に取らない（architecture.md 5節）
const statsGet = implementer.stats.get.use(readProcedure).handler(async ({ context }) => {
  const { db, coupleId, r2Sign } = context;

  const [coupleRow, membersResult, meetupRow, postRow, photoRow] = await Promise.all([
    db
      .prepare(
        "SELECT dating_date AS dating_date, married_date AS married_date, primary_date AS primary_date FROM couples WHERE id = ?1",
      )
      .bind(coupleId)
      .first<CoupleDatesRow>(),
    // 統計カードの2アバター表示に使う。slot昇順で返し、1件なら相手が未参加
    // （008の投稿者名と同じくLEFT JOINで理論上のnullを許容する。architecture.md 5節）
    db
      .prepare(
        `SELECT couple_members.user_id AS user_id, user.name AS name, user.image AS image
           FROM couple_members
           LEFT JOIN user ON user.id = couple_members.user_id
          WHERE couple_members.couple_id = ?1
          ORDER BY couple_members.slot`,
      )
      .bind(coupleId)
      .all<MemberRow>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM events WHERE couple_id = ?1 AND kind = 'meetup'")
      .bind(coupleId)
      .first<CountRow>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM posts WHERE couple_id = ?1 AND deleted_at IS NULL")
      .bind(coupleId)
      .first<CountRow>(),
    // L65: deleted_at IS NULL が抜けていた（タスク定義・architecture.md 4節どちらにも
    // 無かった）。007の決定で論理削除後もimage_keyは残るため、これが無いと
    // 削除済みの写真投稿まで数えてしまう
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM posts WHERE couple_id = ?1 AND deleted_at IS NULL AND image_key IS NOT NULL",
      )
      .bind(coupleId)
      .first<CountRow>(),
  ]);

  // readProcedure が couple_id を確定させた時点で存在は保証されている想定
  // （couple.ts の coupleGet と同じ前提）
  if (!coupleRow) throw new Error("couple_id に対応するペアが見つかりません");

  const members = await Promise.all(
    membersResult.results.map(async (row) => ({
      userId: row.user_id,
      name: row.name,
      // Googleの外部URLか自分でアップロードした画像のR2キーかを判別して解決する
      // （019。apps/api/src/procedures/post.tsのauthorImageと同じ形）
      image: await resolveUserImage(r2Sign, row.image),
    })),
  );

  return {
    daysTogether: computeDaysTogether(coupleRow, todayJst()),
    meetupDays: meetupRow?.count ?? 0,
    postCount: postRow?.count ?? 0,
    photoCount: photoRow?.count ?? 0,
    members,
  };
});

export const statsProcedures = {
  get: statsGet,
};

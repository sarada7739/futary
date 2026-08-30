import type { DaysTogether } from "@futary/contract";
import { diffDays, todayJst } from "@futary/date";
import { implementer } from "../implementer";
import { readProcedure } from "./base";

interface CoupleAnniversaryRow {
  anniversary_date: string;
}

interface MemberRow {
  user_id: string;
  name: string | null;
  image: string | null;
}

interface CountRow {
  count: number;
}

// 記念日当日を1日目とする（境界条件。docs/tasks/012-stats-card.md）。
// 記念日が未来の日付なら「あと○日」を返す（人間の決定。state.md L66）。
// 「負の値を出さない」責任はここ（サーバ側）で閉じる
export function computeDaysTogether(anniversaryDate: string, today: string): DaysTogether {
  const diff = diffDays(anniversaryDate, today);
  if (diff >= 0) return { status: "together", days: diff + 1 };
  return { status: "upcoming", days: -diff };
}

// stats.get は専用テーブルを持たず、既存テーブルから算出する（architecture.md 4節）。
// ctx.coupleId のみを使い、couple_id を引数に取らない（architecture.md 5節）
const statsGet = implementer.stats.get.use(readProcedure).handler(async ({ context }) => {
  const { db, coupleId } = context;

  const [coupleRow, membersResult, meetupRow, postRow, photoRow] = await Promise.all([
    db
      .prepare("SELECT anniversary_date AS anniversary_date FROM couples WHERE id = ?1")
      .bind(coupleId)
      .first<CoupleAnniversaryRow>(),
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

  return {
    daysTogether: computeDaysTogether(coupleRow.anniversary_date, todayJst()),
    meetupCount: meetupRow?.count ?? 0,
    postCount: postRow?.count ?? 0,
    photoCount: photoRow?.count ?? 0,
    members: membersResult.results.map((row) => ({ userId: row.user_id, name: row.name, image: row.image })),
  };
});

export const statsProcedures = {
  get: statsGet,
};

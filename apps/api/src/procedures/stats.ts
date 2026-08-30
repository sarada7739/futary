import type { DaysTogether } from "@futary/contract";
import { diffDays, todayJst } from "@futary/date";
import { implementer } from "../implementer";
import { resolveUserImage } from "../lib/r2-signed-url";
import { readProcedure } from "./base";

interface CoupleDatesRow {
  anniversary_date: string;
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
// 「負の値を出さない」責任はここ（サーバ側）で閉じる
export function computeDaysTogether(couple: CoupleDatesRow, today: string): DaysTogether {
  if (couple.primary_date === "none") return { status: "hidden" };

  if (couple.primary_date === "married") {
    // primary_date='married'ならmarried_dateは非NULL（DBのTRIGGER・入力スキーマの
    // refine両方で保証済み。packages/db/src/schema/couple.ts）
    const diff = diffDays(couple.married_date!, today);
    // 結婚した日が未来（結婚予定日をまだ迎えていない）のケースは019のタスク定義に
    // 明示が無く、Aへ確認中。「負の値を出さない」という既存の制約だけは守り、
    // 暫定的に1日目とする（要確認。docs/worklog.md参照）
    return { status: "married", days: diff >= 0 ? diff + 1 : 1 };
  }

  const diff = diffDays(couple.anniversary_date, today);
  if (diff >= 0) return { status: "together", days: diff + 1 };
  return { status: "upcoming", days: -diff };
}

// stats.get は専用テーブルを持たず、既存テーブルから算出する（architecture.md 4節）。
// ctx.coupleId のみを使い、couple_id を引数に取らない（architecture.md 5節）
const statsGet = implementer.stats.get.use(readProcedure).handler(async ({ context }) => {
  const { db, coupleId, r2Sign } = context;

  const [coupleRow, membersResult, meetupRow, postRow, photoRow] = await Promise.all([
    db
      .prepare(
        "SELECT anniversary_date AS anniversary_date, married_date AS married_date, primary_date AS primary_date FROM couples WHERE id = ?1",
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

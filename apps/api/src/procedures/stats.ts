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

// couples.primary_date に従って daysTogether を出し分ける。記念日当日を 1 日目とし、未来の日付なら
// 「あと○日」を返す（負の値を出さない責任はサーバで閉じる。012・019）。
// dating・married それぞれに upcoming の対を持つ（どちらも主役になりうる数字なので対称にする）。
// primary_date が指す方の日付がまだ無ければ 'unset'（'hidden' = 本人が隠すと決めた、とは分ける。
// もう片方の日付があっても出さない。利用者が選んだ方だけを見る。023）
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

// 専用の表を持たず既存の表から算出する（architecture.md 4節）。couple_id を引数に取らない（5節）
const statsGet = implementer.stats.get.use(readProcedure).handler(async ({ context }) => {
  const { db, coupleId, r2Sign } = context;

  const [coupleRow, membersResult, meetupRow, postRow, photoRow] = await Promise.all([
    db
      .prepare(
        "SELECT dating_date AS dating_date, married_date AS married_date, primary_date AS primary_date FROM couples WHERE id = ?1",
      )
      .bind(coupleId)
      .first<CoupleDatesRow>(),
    // 2 つのアバターに使う。slot 昇順で、1 件なら相手が未参加。LEFT JOIN で理論上の null を許す（architecture.md 5節）
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
    // 写真の枚数は投稿の件数でなく実際の画像の枚数（1 投稿に複数枚付けられる）。
    // post.delete なら post_images も消えるが、deleted_at IS NULL の条件は保つ
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM post_images
           JOIN posts ON posts.id = post_images.post_id
          WHERE posts.couple_id = ?1 AND posts.deleted_at IS NULL`,
      )
      .bind(coupleId)
      .first<CountRow>(),
  ]);

  // readProcedure が couple_id を確定させた時点で存在する想定
  if (!coupleRow) throw new Error("couple_id に対応するペアが見つかりません");

  const members = await Promise.all(
    membersResult.results.map(async (row) => ({
      userId: row.user_id,
      name: row.name,
      // Google の外部 URL か自分で上げた画像の R2 キーかを見分けて解決する
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

import type { MemoryLabel } from "@futary/contract";
import { addDays, jstDayRangeMs, monthsBefore, todayJst, yearsBefore } from "@futary/date";
import { implementer } from "../implementer";
import { createGetUrl, type R2SignConfig } from "../lib/r2-signed-url";
import { readProcedure } from "./base";

// posts を読むクエリには必ず deleted_at IS NULL を含める（architecture.md 4節。
// 例外なし。L69: 忘れると削除した投稿がホームの最上部に「思い出」として復活する）

interface PostRow {
  id: string;
  body: string;
  created_at: number;
}

interface PostImageRow {
  key: string;
  width: number;
  height: number;
}

const POST_COLUMNS = "id AS id, body AS body, created_at AS created_at";

// 031: 1投稿に画像を4枚まで。position順に返す
async function fetchImages(db: D1Database, postId: string): Promise<PostImageRow[]> {
  const { results } = await db
    .prepare(
      `SELECT key AS key, width AS width, height AS height
         FROM post_images WHERE post_id = ?1 ORDER BY position`,
    )
    .bind(postId)
    .all<PostImageRow>();
  return results;
}

async function toMemoryPost(db: D1Database, row: PostRow, r2Sign: R2SignConfig) {
  const imageRows = await fetchImages(db, row.id);
  return {
    id: row.id,
    body: row.body,
    images: await Promise.all(
      imageRows.map(async (image) => ({
        url: await createGetUrl(r2Sign, image.key),
        width: image.width,
        height: image.height,
      })),
    ),
    createdAt: row.created_at,
  };
}

// 指定したJSTの暦日ぴったりの投稿を1件探す。複数あれば画像のある投稿を優先し、
// なければ最新を返す（docs/tasks/013-memory.md）。031: image_key列が無くなった
// ため、post_images の存在で判定する
async function findOnDate(db: D1Database, coupleId: string, date: string): Promise<PostRow | null> {
  const { fromMs, toMs } = jstDayRangeMs(date);
  const row = await db
    .prepare(
      `SELECT ${POST_COLUMNS} FROM posts
        WHERE couple_id = ?1 AND deleted_at IS NULL
          AND created_at >= ?2 AND created_at < ?3
        ORDER BY (NOT EXISTS (SELECT 1 FROM post_images WHERE post_images.post_id = posts.id)) ASC, created_at DESC
        LIMIT 1`,
    )
    .bind(coupleId, Math.floor(fromMs / 1000), Math.floor(toMs / 1000))
    .first<PostRow>();
  return row ?? null;
}

// (coupleId, JST日付) を種にした決定的なハッシュ。ORDER BY RANDOM() は使わない
// （「1日の間は同じ結果を返す」ため。Rレビュー指摘: クライアント側キャッシュでは
// 再取得・リロード・アプリ再起動で崩れるため、サーバ側で決定的にする必要がある）
export function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// 「7日以上前」= 今日からJSTの暦日で7日以上遡った投稿が対象（ちょうど7日前を含む。
// Rレビューで境界を確認済み）。候補をCOUNT(*)で数え、決定的ハッシュ値をcountで
// 割った余りをOFFSETに使う。順序をORDER BY created_at, idで固定しないと、
// 種が決定的でも行の順序がSQLiteの裁量になり全体が決定的にならない（Rレビュー指摘）
async function findRandomOld(db: D1Database, coupleId: string, today: string): Promise<PostRow | null> {
  const cutoffDate = addDays(today, -6);
  const cutoffSeconds = Math.floor(jstDayRangeMs(cutoffDate).fromMs / 1000);

  const countRow = await db
    .prepare("SELECT COUNT(*) AS count FROM posts WHERE couple_id = ?1 AND deleted_at IS NULL AND created_at < ?2")
    .bind(coupleId, cutoffSeconds)
    .first<{ count: number }>();
  const count = countRow?.count ?? 0;
  if (count === 0) return null;

  const offset = stableHash(`${coupleId}:${today}`) % count;
  const row = await db
    .prepare(
      `SELECT ${POST_COLUMNS} FROM posts
        WHERE couple_id = ?1 AND deleted_at IS NULL AND created_at < ?2
        ORDER BY created_at ASC, id ASC
        LIMIT 1 OFFSET ?3`,
    )
    .bind(coupleId, cutoffSeconds, offset)
    .first<PostRow>();
  return row ?? null;
}

// 探索順（ADR-006・architecture.md 5節）: 1ヶ月前 → 半年前 → 1年前 → 7日以上前
// からランダムに1件 → 該当なし（null）。「存在しない日付は月末に寄せる」（L61）が
// ここで初めて利用者から見える（3/29・30・31の1ヶ月前は3日とも2/28になる）
const memoryGet = implementer.memory.get.use(readProcedure).handler(async ({ context }) => {
  const { db, coupleId, r2Sign } = context;
  const today = todayJst();

  const milestones: Array<{ date: string; label: MemoryLabel }> = [
    { date: monthsBefore(today, 1), label: "oneMonthAgo" },
    { date: monthsBefore(today, 6), label: "halfYearAgo" },
    { date: yearsBefore(today, 1), label: "oneYearAgo" },
  ];

  for (const milestone of milestones) {
    const row = await findOnDate(db, coupleId, milestone.date);
    if (row) return { post: await toMemoryPost(db, row, r2Sign), label: milestone.label };
  }

  const randomRow = await findRandomOld(db, coupleId, today);
  if (randomRow) return { post: await toMemoryPost(db, randomRow, r2Sign), label: "random" as const };

  return null;
});

export const memoryProcedures = {
  get: memoryGet,
};

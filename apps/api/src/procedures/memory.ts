import type { MemoryLabel } from "@futary/contract";
import { addDays, jstDayRangeMs, monthsBefore, todayJst, yearsBefore } from "@futary/date";
import { implementer } from "../implementer";
import { createGetUrl, type R2SignConfig } from "../lib/r2-signed-url";
import { readProcedure } from "./base";

// posts を読むクエリには必ず deleted_at IS NULL を含める（忘れると削除した投稿が「思い出」として
// 戻ってくる。architecture.md 4節）

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

// 1 投稿に画像 4 枚まで。position 順
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

// JST の暦日ぴったりの投稿を 1 件探す。複数あれば画像のある投稿（post_images がある）を優先し、なければ最新（013）
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

// (coupleId, JST の日付) を種にした決定的なハッシュ。1 日の間は同じ結果を返すためで、
// ORDER BY RANDOM() やクライアントのキャッシュ（リロードで崩れる）では足りない
export function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// 「7 日以上前」= JST の暦日で 7 日以上遡った投稿（ちょうど 7 日前を含む）。候補を COUNT(*) で数え、
// ハッシュを件数で割った余りを OFFSET にする。ORDER BY created_at, id で順を固定しないと、
// 行の順が SQLite の裁量になって決定的にならない
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

// 探す順（ADR-006・architecture.md 5節）: 1 ヶ月前 → 半年前 → 1 年前 → 7 日以上前からランダムに 1 件 → null。
// 存在しない日付は月末に寄せる（3/29・30・31 の 1 ヶ月前は 3 日とも 2/28）
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

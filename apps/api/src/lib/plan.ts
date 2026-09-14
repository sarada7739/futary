// 045: ペアのプラン（free / paid）と、無料枠（作ったアルバムの写真の合計枚数）。
// 判定はここの 1 箇所に閉じる。手続き（couple.get・album.create・album.addPhotos）は
// ここを呼ぶだけで、couple_plans の列の意味を知らない
import { FREE_ALBUM_PHOTO_LIMIT, type AlbumQuota, type Plan } from "@futary/contract";

export { FREE_ALBUM_PHOTO_LIMIT };

// couple_plans の 1 行。行が無ければ null（= free）
export interface CouplePlanRow {
  plan: string;
  expires_at: number | null;
}

// paid は plan = 'paid' AND (expires_at IS NULL OR expires_at > now) のときだけ。
// それ以外（行が無い・'free'・未知の文字列・期限切れ）は全部 free（タスク定義 1節）。
// CHECK を持たない表なので、未知の値が入っても壊れない向きに倒す
export function resolvePlan(row: CouplePlanRow | null | undefined, nowSeconds: number): Plan {
  if (!row || row.plan !== "paid") return "free";
  if (row.expires_at !== null && row.expires_at <= nowSeconds) return "free";
  return "paid";
}

export async function loadPlan(db: D1Database, coupleId: string, nowSeconds: number): Promise<Plan> {
  const row = await db
    .prepare("SELECT plan AS plan, expires_at AS expires_at FROM couple_plans WHERE couple_id = ?1")
    .bind(coupleId)
    .first<CouplePlanRow>();
  return resolvePlan(row, nowSeconds);
}

// 無料枠の使用量: ペアの未削除のアルバムに入っている album_photos の行数を 1 文で数える
// （albums.deleted_at IS NULL を JOIN に含める。タイムライン post_images は数えない。
// 別ペアの写真は albums.couple_id で切れる）。album_photos は album_id の索引
// （album_photos_album_taken_idx の先頭列）で JOIN できる
export async function countAlbumPhotosUsed(db: D1Database, coupleId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
         FROM album_photos
         JOIN albums ON albums.id = album_photos.album_id AND albums.deleted_at IS NULL
        WHERE albums.couple_id = ?1`,
    )
    .bind(coupleId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// couple.get が返す枠。paid なら null（制限しない）
export async function albumQuotaFor(db: D1Database, coupleId: string, plan: Plan): Promise<AlbumQuota | null> {
  if (plan === "paid") return null;
  return { limit: FREE_ALBUM_PHOTO_LIMIT, used: await countAlbumPhotosUsed(db, coupleId) };
}

// album.create（cover あり）・album.addPhotos が写真を足す前に呼ぶ。
// free で used + 追加枚数 > limit なら true（呼び出し側が PLAN_LIMIT を投げる。1 枚も入れない）。
// 数えてから書くまでの間に相手が足すと数枚は超えうる（D1 にトランザクションは無い）。
// 物理上限と違い超えても壊れないので、ここでは許す（タスク定義 2節。architecture.md 4節
// 「読んでから判断して書く形にしない」の例外）
export async function exceedsFreeQuota(
  db: D1Database,
  coupleId: string,
  adding: number,
  nowSeconds: number,
): Promise<boolean> {
  if (adding <= 0) return false;
  const plan = await loadPlan(db, coupleId, nowSeconds);
  if (plan === "paid") return false;
  const used = await countAlbumPhotosUsed(db, coupleId);
  return used + adding > FREE_ALBUM_PHOTO_LIMIT;
}

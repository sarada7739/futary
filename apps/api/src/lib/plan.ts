// 045: ペアのプラン（free / paid）と、無料枠（作ったアルバムの写真の合計枚数）。
// 判定はここの 1 箇所に閉じる。手続き（couple.get・album.create・album.addPhotos）は
// ここを呼ぶだけで、couple_plans の列の意味を知らない
import { FREE_ALBUM_PHOTO_LIMIT, LOCK_GRACE_DAYS, type AlbumQuota, type Plan, type PlanState } from "@futary/contract";

export { FREE_ALBUM_PHOTO_LIMIT };

// 047: 猶予（秒）。free に戻ってからこれだけ経つと、無料枠を超える写真に鍵が掛かる
export const LOCK_GRACE_SECONDS = LOCK_GRACE_DAYS * 24 * 60 * 60;

// couple_plans の 1 行。行が無ければ null（= free）。
// 047: 猶予の起点に source と updated_at も使う（0節 #11）
export interface CouplePlanRow {
  plan: string;
  expires_at: number | null;
  source?: string;
  updated_at?: number;
}

// paid は plan = 'paid' AND (expires_at IS NULL OR expires_at > now) のときだけ。
// それ以外（行が無い・'free'・未知の文字列・期限切れ）は全部 free（タスク定義 1節）。
// CHECK を持たない表なので、未知の値が入っても壊れない向きに倒す
export function resolvePlan(row: CouplePlanRow | null | undefined, nowSeconds: number): Plan {
  return resolvePlanState(row, nowSeconds).plan;
}

// 047: 猶予の起点（秒）。無ければ null（鍵は掛からない）。047 0節 #11:
// - expires_at があればそれ（Stripe の canceled は plan='free' で expires_at を残す。期限切れで free になった行も同じ）
// - expires_at が無い free の行: source='manual' なら updated_at（運営が手で free にした）。
//   source='stripe' なら null（Checkout を作るときに先に書く plan='free' の行。一度も paid になっていない）
// - どれにも当てはまらない形（未知の source・updated_at 無し）は null（鍵を掛けない向きに倒す）
function lockOriginOf(row: CouplePlanRow): number | null {
  if (row.expires_at !== null) return row.expires_at;
  if (row.source === "manual" && typeof row.updated_at === "number") return row.updated_at;
  return null;
}

// 047: プランの状態（paid / free の猶予中 / free の鍵）。判定はここの 1 箇所（タスク定義 1節）
export function resolvePlanState(row: CouplePlanRow | null | undefined, nowSeconds: number): PlanState {
  if (!row) return { plan: "free", lockAt: null, locked: false };
  if (row.plan === "paid" && (row.expires_at === null || row.expires_at > nowSeconds)) return { plan: "paid" };
  const origin = lockOriginOf(row);
  if (origin === null) return { plan: "free", lockAt: null, locked: false };
  const lockAt = origin + LOCK_GRACE_SECONDS;
  return { plan: "free", lockAt, locked: nowSeconds >= lockAt };
}

export function isLocked(state: PlanState): boolean {
  return state.plan === "free" && state.locked;
}

// 048 段階2: couple_plans の行そのもの（couple.get の planSource/planExpiresAt と、
// billing.* が customer / subscription を引くのに使う）
export interface CouplePlanFullRow extends CouplePlanRow {
  source: string;
  updated_at: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_cancel_at: number | null;
}

export async function loadPlanRow(db: D1Database, coupleId: string): Promise<CouplePlanFullRow | null> {
  const row = await db
    .prepare(
      `SELECT plan AS plan, source AS source, expires_at AS expires_at, updated_at AS updated_at,
              stripe_customer_id AS stripe_customer_id, stripe_subscription_id AS stripe_subscription_id,
              stripe_cancel_at AS stripe_cancel_at
         FROM couple_plans WHERE couple_id = ?1`,
    )
    .bind(coupleId)
    .first<CouplePlanFullRow>();
  return row ?? null;
}

export async function loadPlan(db: D1Database, coupleId: string, nowSeconds: number): Promise<Plan> {
  return resolvePlan(await loadPlanRow(db, coupleId), nowSeconds);
}

export async function loadPlanState(db: D1Database, coupleId: string, nowSeconds: number): Promise<PlanState> {
  return resolvePlanState(await loadPlanRow(db, coupleId), nowSeconds);
}

// 047: 鍵でない写真（taken_at, id の昇順の先頭 FREE_ALBUM_PHOTO_LIMIT 枚。ペアの未削除アルバムをまたいで数える）。
// 鍵かどうかは「この中に無い」で決める。鍵の側の集合は作らない（055 で 1 ペア数十万枚になりうる。0節 #13）。
// locked のときだけ呼ぶ（paid・猶予中は引かない）。album_id・key・大きさ・taken_at も返すのは、
// カバーが鍵の写真だったときに「鍵でない中でいちばん新しいもの」へ倒すため（1節）
export interface UnlockedPhoto {
  id: string;
  album_id: string;
  key: string;
  width: number;
  height: number;
  taken_at: number;
}

export async function unlockedPhotos(db: D1Database, coupleId: string): Promise<UnlockedPhoto[]> {
  const { results } = await db
    .prepare(
      `SELECT album_photos.id AS id, album_photos.album_id AS album_id, album_photos.key AS key,
              album_photos.width AS width, album_photos.height AS height, album_photos.taken_at AS taken_at
         FROM album_photos
         JOIN albums ON albums.id = album_photos.album_id AND albums.deleted_at IS NULL
        WHERE albums.couple_id = ?1
        ORDER BY album_photos.taken_at ASC, album_photos.id ASC
        LIMIT ?2`,
    )
    .bind(coupleId, FREE_ALBUM_PHOTO_LIMIT)
    .all<UnlockedPhoto>();
  return results;
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

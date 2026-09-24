// ペアのプラン（free / paid）と無料枠（アルバムの写真の合計枚数）。判定はここの 1 箇所に閉じ、
// 手続きは couple_plans の列の意味を知らない（045）
import { FREE_ALBUM_PHOTO_LIMIT, LOCK_GRACE_DAYS, type AlbumQuota, type Plan, type PlanState } from "@futary/contract";

export { FREE_ALBUM_PHOTO_LIMIT };

// 猶予（秒）。free に戻ってからこれだけ経つと、無料枠を超える写真に鍵が掛かる（047）
export const LOCK_GRACE_SECONDS = LOCK_GRACE_DAYS * 24 * 60 * 60;

// couple_plans の 1 行。行が無ければ null（= free）
export interface CouplePlanRow {
  plan: string;
  expires_at: number | null;
  source?: string;
  updated_at?: number;
}

// paid は plan = 'paid' AND (expires_at IS NULL OR expires_at > now) のときだけ。それ以外（行が無い・
// 'free'・未知の文字列・期限切れ）は全部 free。CHECK を持たない表なので、未知の値は壊れない側に倒す
export function resolvePlan(row: CouplePlanRow | null | undefined, nowSeconds: number): Plan {
  return resolvePlanState(row, nowSeconds).plan;
}

// 猶予の起点（秒）。無ければ null（鍵は掛からない）:
// - expires_at があればそれ（Stripe の canceled と期限切れは plan='free' で expires_at を残す）
// - expires_at が無い free の行: source='manual' なら updated_at（運営が手で free にした）。
//   source='stripe' なら null（Checkout の前に書く行で、一度も paid になっていない）
// - それ以外（未知の source・updated_at 無し）は null（鍵を掛けない側に倒す）
function lockOriginOf(row: CouplePlanRow): number | null {
  if (row.expires_at !== null) return row.expires_at;
  if (row.source === "manual" && typeof row.updated_at === "number") return row.updated_at;
  return null;
}

// プランの状態（paid / free の猶予中 / free の鍵）。判定はここの 1 箇所
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

// couple_plans の行そのもの（couple.get の planSource・planExpiresAt と、billing.* の customer・subscription）
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

// 鍵でない写真（ペアの未削除アルバムをまたいだ taken_at, id の昇順の先頭 FREE_ALBUM_PHOTO_LIMIT 枚）。
// 鍵かどうかは「この中に無い」で決め、鍵の側の集合は作らない（1 ペア数十万枚になりうる）。
// locked のときだけ呼ぶ。album_id・key・大きさも返すのは、鍵のカバーを倒す先を選ぶため
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

// 無料枠の使用量: ペアの未削除アルバムの album_photos の行数（タイムラインの post_images は数えない）。
// album_photos は album_id の索引で JOIN できる
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

// 写真を足す前に呼ぶ。free で used + 追加枚数 > limit なら true（呼び出し側が PLAN_LIMIT。1 枚も入れない）。
// 数えてから書くまでに相手が足すと数枚超えうる（D1 にトランザクションは無い）が、物理上限と違い
// 超えても壊れないので許す（architecture.md 4節の「読んでから判断して書かない」の例外）
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

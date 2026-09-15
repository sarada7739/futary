// 048 段階2: 購読の状態 → couple_plans の upsert。判定はここの 1 箇所に閉じる
// （Webhook はどの event でも Stripe から読み直した SubscriptionSnapshot をここに渡すだけ）
import type { BillingPrices } from "@futary/contract";
import type { StripeGateway, SubscriptionSnapshot } from "./stripe";

// index.ts が c.env から組む。手続きと Webhook はこれだけを見る
export interface BillingContext {
  gateway: StripeGateway;
  priceMonthly: string;
  priceYearly: string;
  // Checkout の success_url / cancel_url・Portal の return_url の起点（BETTER_AUTH_URL。
  // 本番は https://nisoine.com。直書きしない。タスク定義 3節）
  appOrigin: string;
}

// Stripe の status → plan（タスク定義 3節 Webhook）
// - active / trialing → paid（expires_at = current_period_end）
// - past_due → paid のまま（expires_at が来れば free。Stripe の再試行に任せる）
// - canceled / unpaid / incomplete_expired / incomplete / paused → free（expires_at は残す。047 の猶予の起点）
export function planFromStatus(status: string): "paid" | "free" {
  return status === "active" || status === "trialing" || status === "past_due" ? "paid" : "free";
}

export type ApplyResult = "written" | "skipped_manual" | "skipped_no_couple";

// 購読の今の状態で couple_plans を upsert する。
// - source='manual' の行は書かない（運営の判断が Stripe に上書きされない）
// - coupleId が無い（このアプリが作った customer ではない）なら何もしない
// - 同じ snapshot を 2 回渡しても結果は同じ（冪等。UPSERT）
// - free になるときも expires_at は残す（047 の猶予の起点）。paid なのに current_period_end が
//   無い（無い形の購読）なら expires_at を NULL にはせず今の値を残す（無期限 paid を作らない）
export async function applySubscriptionSnapshot(
  db: D1Database,
  snapshot: SubscriptionSnapshot,
  nowSeconds: number,
): Promise<ApplyResult> {
  const coupleId = snapshot.coupleId;
  if (!coupleId) return "skipped_no_couple";

  const existing = await db
    .prepare("SELECT source AS source FROM couple_plans WHERE couple_id = ?1")
    .bind(coupleId)
    .first<{ source: string }>();
  if (existing && existing.source === "manual") return "skipped_manual";

  const plan = planFromStatus(snapshot.status);
  // paid のときは期限を必ず持つ。取れなければ既存の値を保つ（COALESCE）
  const expiresAt = snapshot.currentPeriodEnd;
  await db
    .prepare(
      `INSERT INTO couple_plans (couple_id, plan, source, expires_at, updated_at, stripe_customer_id, stripe_subscription_id, stripe_cancel_at)
       VALUES (?1, ?2, 'stripe', ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(couple_id) DO UPDATE SET
         plan = excluded.plan,
         source = 'stripe',
         expires_at = COALESCE(excluded.expires_at, couple_plans.expires_at),
         updated_at = excluded.updated_at,
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         stripe_cancel_at = excluded.stripe_cancel_at`,
    )
    .bind(coupleId, plan, expiresAt, nowSeconds, snapshot.customerId, snapshot.id, snapshot.cancelAt)
    .run();
  return "written";
}

// billing.prices のキャッシュ（Worker のメモリ。1 時間）。isolate ごとに空から始まる
const PRICES_TTL_MS = 60 * 60 * 1000;
let pricesCache: { at: number; value: BillingPrices } | null = null;

export async function loadPrices(billing: BillingContext, nowMs: number): Promise<BillingPrices> {
  if (pricesCache && nowMs - pricesCache.at < PRICES_TTL_MS) return pricesCache.value;
  const [monthly, yearly] = await Promise.all([
    billing.gateway.retrievePrice(billing.priceMonthly),
    billing.gateway.retrievePrice(billing.priceYearly),
  ]);
  const value: BillingPrices = {
    monthly: { ...monthly, priceId: billing.priceMonthly },
    yearly: { ...yearly, priceId: billing.priceYearly },
  };
  pricesCache = { at: nowMs, value };
  return value;
}

// テスト用
export function resetPricesCache(): void {
  pricesCache = null;
}

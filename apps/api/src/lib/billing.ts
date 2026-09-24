// 購読の状態 → couple_plans の upsert。判定はここの 1 箇所（Webhook は読み直した snapshot を渡すだけ。048）
import type { BillingPrices } from "@futary/contract";
import type { StripeGateway, SubscriptionSnapshot } from "./stripe";

// index.ts が c.env から組む。手続きと Webhook はこれだけを見る
export interface BillingContext {
  gateway: StripeGateway;
  priceMonthly: string;
  priceYearly: string;
  // Checkout・Portal の戻り先の起点（BETTER_AUTH_URL。直書きしない）
  appOrigin: string;
}

// Stripe の status → plan
// - active / trialing → paid（expires_at = current_period_end）
// - past_due → paid のまま（expires_at が来れば free。Stripe の再試行に任せる）
// - canceled / unpaid / incomplete_expired / incomplete / paused → free（expires_at は残す。047 の猶予の起点）
export function planFromStatus(status: string): "paid" | "free" {
  return status === "active" || status === "trialing" || status === "past_due" ? "paid" : "free";
}

export type ApplyResult =
  | "written"
  | "written_replaced_subscription"
  | "skipped_manual"
  | "skipped_no_couple"
  | "skipped_other_subscription";

// 購読の今の状態で couple_plans を upsert する。
// - source='manual' の行は書かない（運営の判断が Stripe に上書きされない）
// - coupleId が無い（このアプリが作った customer ではない）なら何もしない
// - 同じ snapshot を 2 回渡しても結果は同じ（冪等。UPSERT）
// - free になるときも expires_at は残す（047 の猶予の起点）。paid なのに current_period_end が
//   無い（無い形の購読）なら expires_at を NULL にはせず今の値を残す（無期限 paid を作らない）
// - 行に付いた購読と違う購読の snapshot: 「読み直すので順序に依存しない」は同じ購読の中でしか
//   成り立たず、同じ customer に 2 本目の購読ができる経路（同時に 2 人が押す・再申し込み）がある。
//   - snapshot が paid → 2 本目。行の購読を解約して（済みなら何もしない）新しい方を書く
//   - paid でない → 別の購読が終わっただけ（遅れて届いた deleted 等）。書かない
export async function applySubscriptionSnapshot(
  db: D1Database,
  gateway: Pick<StripeGateway, "cancelSubscription">,
  snapshot: SubscriptionSnapshot,
  nowSeconds: number,
  log?: (line: string) => void,
): Promise<ApplyResult> {
  const coupleId = snapshot.coupleId;
  if (!coupleId) return "skipped_no_couple";

  const existing = await db
    .prepare("SELECT source AS source, stripe_subscription_id AS stripe_subscription_id FROM couple_plans WHERE couple_id = ?1")
    .bind(coupleId)
    .first<{ source: string; stripe_subscription_id: string | null }>();
  if (existing && existing.source === "manual") return "skipped_manual";

  const plan = planFromStatus(snapshot.status);
  let result: ApplyResult = "written";
  const current = existing?.stripe_subscription_id ?? null;
  if (current && current !== snapshot.id) {
    if (plan !== "paid") return "skipped_other_subscription";
    // 2 本目が生きているので古い方を解約する（二重課金にしない）。失敗したら例外 → 500 → Stripe が再送する
    await gateway.cancelSubscription(current);
    // 既に canceled だった（再申し込み）なら no-op なので、文言で「解約した」とは書かない
    log?.(`stripe: second subscription for couple=${coupleId.slice(0, 8)}: replaced ${current.slice(0, 12)} (cancel requested; no-op if already ended) with ${snapshot.id.slice(0, 12)}`);
    result = "written_replaced_subscription";
  }
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
  return result;
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

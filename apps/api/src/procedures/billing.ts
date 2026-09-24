// プレミアムの決済（Stripe Checkout・Billing Portal。048）。カード情報はこちらを通らない。
// couple_plans を書くのは Webhook だけで、ここでは customer を作ったときの行（plan='free'・source='stripe'）だけを書く
import { implementer } from "../implementer";
import { writeProcedure } from "./base";
import { loadPlanRow, resolvePlan } from "../lib/plan";
import { loadPrices, type BillingContext } from "../lib/billing";
import type { RpcContext } from "../context";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// Stripe が設定されていない環境で呼ばれたら 500（黙って free や空にしない）
function requireBilling(context: RpcContext): BillingContext {
  if (!context.billing) {
    throw new Error("Stripe が設定されていません（STRIPE_SECRET_KEY / STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY）");
  }
  return context.billing;
}

// 価格。認証・ペア所属を問わない（ゲストも見られる）
const billingPrices = implementer.billing.prices.handler(async ({ context }) => {
  return loadPrices(requireBilling(context), Date.now());
});

const billingCreateCheckoutSession = implementer.billing.createCheckoutSession
  .use(writeProcedure)
  .handler(async ({ context, input, errors }) => {
    const billing = requireBilling(context);
    const { db, coupleId } = context;

    const existing = await loadPlanRow(db, coupleId);
    // 既に paid（manual でも stripe でも）なら申し込ませない
    if (resolvePlan(existing, nowSeconds()) === "paid") throw errors.CONFLICT();

    // customer はペアに 1 つ。無ければ作って、先に plan='free'・source='stripe' で保存する
    // （Checkout の途中で Webhook が先に来ても customer から couple_id が引ける）。
    // manual の free（運営が手で落とした）は source を stripe に変える（manual の paid は上で CONFLICT）
    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      customerId = await billing.gateway.createCustomer(coupleId);
      await db
        .prepare(
          `INSERT INTO couple_plans (couple_id, plan, source, expires_at, updated_at, stripe_customer_id, stripe_subscription_id)
           VALUES (?1, 'free', 'stripe', NULL, ?2, ?3, NULL)
           ON CONFLICT(couple_id) DO UPDATE SET
             source = 'stripe', updated_at = excluded.updated_at, stripe_customer_id = excluded.stripe_customer_id`,
        )
        .bind(coupleId, nowSeconds(), customerId)
        .run();
    }

    const priceId = input.interval === "month" ? billing.priceMonthly : billing.priceYearly;
    const url = await billing.gateway.createCheckoutSession({
      customerId,
      priceId,
      coupleId,
      successUrl: `${billing.appOrigin}/app/premium?status=success`,
      cancelUrl: `${billing.appOrigin}/app/premium`,
    });
    return { url };
  });

const billingCreatePortalSession = implementer.billing.createPortalSession
  .use(writeProcedure)
  .handler(async ({ context, errors }) => {
    const billing = requireBilling(context);
    const existing = await loadPlanRow(context.db, context.coupleId);
    // customer が無ければ NOT_FOUND。customer は自分のペアの行からしか引かない（他ペアの customer で作れない）
    if (!existing?.stripe_customer_id) throw errors.NOT_FOUND();
    const url = await billing.gateway.createPortalSession({
      customerId: existing.stripe_customer_id,
      returnUrl: `${billing.appOrigin}/app/profile`,
    });
    return { url };
  });

export const billingProcedures = {
  prices: billingPrices,
  createCheckoutSession: billingCreateCheckoutSession,
  createPortalSession: billingCreatePortalSession,
};

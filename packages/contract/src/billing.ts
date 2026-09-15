import { oc } from "@orpc/contract";
import { z } from "zod";

// 048 段階2: プレミアムの決済（Stripe）。docs/tasks/048-premium-payment.md 3節。
// カード情報はこちらを通らない（Checkout と Billing Portal は Stripe の画面へリダイレクト）。
// Stripe に送るのは couple_id だけ（名前・メールは送らない）

// 月額 / 年額。Stripe の Price の recurring.interval と同じ語
export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

// 価格 1 つ。amount は最小単位（JPY は円そのもの）。priceId は Stripe の price_…（秘密ではない）
export const billingPriceSchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  priceId: z.string(),
});
export type BillingPrice = z.infer<typeof billingPriceSchema>;

export const billingPricesSchema = z.object({
  monthly: billingPriceSchema,
  yearly: billingPriceSchema,
});
export type BillingPrices = z.infer<typeof billingPricesSchema>;

// billing.prices: 2 つの価格。Stripe から読む（Worker のメモリに 1 時間キャッシュ）。
// 認証・ペア所属を問わない（ゲストも価格は見られる。ボタンは「ログインして始める」）
export const billingPricesContract = oc.input(z.object({})).output(billingPricesSchema);

// billing.createCheckoutSession: Stripe Checkout の URL を返す。既に paid なら CONFLICT。
// customer はペアに 1 つ（無ければ作って couple_plans に plan='free', source='stripe' で先に保存）
export const billingCreateCheckoutSessionContract = oc
  .input(z.object({ interval: z.enum(BILLING_INTERVALS) }))
  .output(z.object({ url: z.string() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    CONFLICT: { status: 409 },
  });

// billing.createPortalSession: Stripe Billing Portal（解約・カード変更）の URL。
// stripe_customer_id が無ければ NOT_FOUND（申し込んだことが無い・manual のペア）
export const billingCreatePortalSessionContract = oc
  .input(z.object({}))
  .output(z.object({ url: z.string() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

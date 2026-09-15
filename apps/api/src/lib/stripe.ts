// 048 段階2: Stripe の窓口。手続き（procedures/billing.ts）と Webhook（stripe-webhook.ts）は
// この StripeGateway だけを呼び、SDK の型を見ない。テストは偽の gateway を context に積む
// （lib/ai.ts の AiEnv と同じ「この機能が使う値だけに絞った構造体」の方針）。
//
// SDK は `stripe` npm。Workers から呼ぶので Stripe.createFetchHttpClient()（Node の https を
// 使わない）、Webhook の署名は createSubtleCryptoProvider()（WebCrypto）で確かめる。
// Stripe に送る個人情報は couple_id だけ（名前・メールは送らない。領収書のメールは
// Checkout の画面で利用者が自分で入れる）
import Stripe from "stripe";

// index.ts が c.env から組み立てて渡す。手続きは中身を見ない
export interface StripeEnv {
  secretKey?: string;
  webhookSecret?: string;
  priceMonthly?: string;
  priceYearly?: string;
}

// 購読の「今」。Webhook はどの event でもこれを Stripe から読み直して couple_plans を upsert する
// （event の中身を信じない。順序に依存しない。同じ event が 2 回来ても結果が同じ）
export interface SubscriptionSnapshot {
  id: string;
  customerId: string;
  // customer の metadata.couple_id。無ければ null（このアプリが作った customer ではない）
  coupleId: string | null;
  status: string;
  // 秒。items の current_period_end の最大。無ければ null
  currentPeriodEnd: number | null;
  // 「期間の終わりで解約」の終了日時（秒）。今の Stripe は Portal の解約を cancel_at で表す
  // （cancel_at_period_end は false のまま。実測）。古い形（cancel_at_period_end=true）も同じ意味に寄せる。
  // 解約していなければ null
  cancelAt: number | null;
}

// Webhook の event のうち、こちらが見る部分だけ
export interface WebhookEventSummary {
  id: string;
  type: string;
  // event から辿れる購読の id（subscription.* は data.object.id、checkout.session.completed は
  // data.object.subscription、invoice.* は parent.subscription_details.subscription）。無ければ null
  subscriptionId: string | null;
  customerId: string | null;
}

export interface StripeGateway {
  retrievePrice(priceId: string): Promise<{ amount: number; currency: string }>;
  createCustomer(coupleId: string): Promise<string>;
  createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    coupleId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<string>;
  retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot>;
  // customer の購読のうち一番新しいもの（event に購読 id が無いときの保険）。無ければ null
  latestSubscriptionOf(customerId: string): Promise<SubscriptionSnapshot | null>;
  // 退会時。既に解約済みなら何もしない（冪等）
  cancelSubscription(subscriptionId: string): Promise<void>;
  // 署名が違えば投げる（呼び出し側が 400 にする）
  constructWebhookEvent(rawBody: string, signature: string): Promise<WebhookEventSummary>;
}

function toSnapshot(sub: Stripe.Subscription): SubscriptionSnapshot {
  const customer = sub.customer;
  const customerId = typeof customer === "string" ? customer : customer.id;
  const coupleId =
    typeof customer === "object" && !("deleted" in customer && customer.deleted)
      ? ((customer as Stripe.Customer).metadata?.couple_id ?? null)
      : null;
  // 2025-03 以降の API では current_period_end は購読ではなく items にある
  const ends = sub.items.data.map((item) => item.current_period_end).filter((n): n is number => typeof n === "number");
  const currentPeriodEnd = ends.length > 0 ? Math.max(...ends) : null;
  const cancelAt = typeof sub.cancel_at === "number" ? sub.cancel_at : sub.cancel_at_period_end ? currentPeriodEnd : null;
  return {
    id: sub.id,
    customerId,
    coupleId,
    status: sub.status,
    currentPeriodEnd,
    cancelAt,
  };
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function createStripeGateway(env: StripeEnv): StripeGateway {
  if (!env.secretKey) {
    throw new Error("STRIPE_SECRET_KEY が未設定です。.dev.vars / wrangler secret を確認してください");
  }
  const stripe = new Stripe(env.secretKey, { httpClient: Stripe.createFetchHttpClient() });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();
  const webhookSecret = env.webhookSecret;

  return {
    async retrievePrice(priceId) {
      const price = await stripe.prices.retrieve(priceId);
      return { amount: price.unit_amount ?? 0, currency: price.currency };
    },

    async createCustomer(coupleId) {
      const customer = await stripe.customers.create({ metadata: { couple_id: coupleId } });
      return customer.id;
    },

    async createCheckoutSession({ customerId, priceId, coupleId, successUrl, cancelUrl }) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { couple_id: coupleId },
        subscription_data: { metadata: { couple_id: coupleId } },
        // Managed Payments（Stripe が販売者として税務を代行する仕組み）は新しいアカウントで既定オンで、
        // オンだと商品に税コードが無い Checkout を拒む（実測: "the product tax code is missing"）。
        // 日本の個人が日本向けに税込価格で売るだけなので使わない（Stripe Tax も「手動」）。
        // ダッシュボードの既定に頼らず、セッションごとに明示してオフにする
        managed_payments: { enabled: false },
      });
      if (!session.url) throw new Error("Stripe Checkout の URL が返りませんでした");
      return session.url;
    },

    async createPortalSession({ customerId, returnUrl }) {
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return session.url;
    },

    async retrieveSubscription(subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["customer"] });
      return toSnapshot(sub);
    },

    async latestSubscriptionOf(customerId) {
      const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1, expand: ["data.customer"] });
      const sub = list.data[0];
      return sub ? toSnapshot(sub) : null;
    },

    async cancelSubscription(subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      if (sub.status === "canceled") return;
      await stripe.subscriptions.cancel(subscriptionId);
    },

    async constructWebhookEvent(rawBody, signature) {
      if (!webhookSecret) {
        throw new Error("STRIPE_WEBHOOK_SECRET が未設定です。.dev.vars / wrangler secret を確認してください");
      }
      const event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret, undefined, cryptoProvider);
      return summarizeEvent(event);
    },
  };
}

// event の種類ごとに購読 id と customer id を取り出す。見ない種類は id だけ（呼び出し側が無視する）
export function summarizeEvent(event: Stripe.Event): WebhookEventSummary {
  const base = { id: event.id, type: event.type, subscriptionId: null as string | null, customerId: null as string | null };
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      return { ...base, subscriptionId: idOf(session.subscription), customerId: idOf(session.customer) };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      return { ...base, subscriptionId: sub.id, customerId: idOf(sub.customer) };
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const details = invoice.parent?.subscription_details;
      return { ...base, subscriptionId: idOf(details?.subscription), customerId: idOf(invoice.customer) };
    }
    default:
      return base;
  }
}

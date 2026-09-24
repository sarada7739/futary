import { env } from "cloudflare:test";
import { call, ORPCError } from "@orpc/server";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";
import { applySubscriptionSnapshot, planFromStatus, resetPricesCache, type BillingContext } from "../src/lib/billing";
import { createStripeGateway, summarizeEvent, type StripeGateway, type SubscriptionSnapshot } from "../src/lib/stripe";
import { handleStripeWebhook } from "../src/stripe-webhook";

// 決済（048 P1〜P5・P8）。Stripe は偽の gateway（FakeStripe）で差し替える。Webhook の署名だけは本物
// （stripe の Webhooks.constructEventAsync）で確かめる: テストが HMAC で署名を作り、
// FakeStripe.constructWebhookEvent がそれを本物の検証に通す

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

const r2Sign: RpcContext["r2Sign"] = {
  accountId: "test-account",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  bucketName: "test-bucket",
};

const WEBHOOK_SECRET = "whsec_test_for_billing_test";
const PRICE_MONTHLY = "price_month_test";
const PRICE_YEARLY = "price_year_test";
const APP_ORIGIN = "https://nisoine.com";

// 偽の Stripe。customer と購読をメモリに持つ。呼ばれた引数を記録する
class FakeStripe implements StripeGateway {
  customers = new Map<string, { coupleId: string }>();
  subscriptions = new Map<string, SubscriptionSnapshot>();
  checkoutCalls: Parameters<StripeGateway["createCheckoutSession"]>[0][] = [];
  portalCalls: Parameters<StripeGateway["createPortalSession"]>[0][] = [];
  canceled: string[] = [];
  deletedCustomers: string[] = [];
  cancelShouldFail = false;
  deleteCustomerShouldFail = false;
  seq = 0;

  async retrievePrice(priceId: string) {
    return priceId === PRICE_MONTHLY ? { amount: 420, currency: "jpy" } : { amount: 4200, currency: "jpy" };
  }
  async createCustomer(coupleId: string) {
    const id = `cus_${++this.seq}`;
    this.customers.set(id, { coupleId });
    return id;
  }
  async createCheckoutSession(input: Parameters<StripeGateway["createCheckoutSession"]>[0]) {
    this.checkoutCalls.push(input);
    return `https://checkout.stripe.com/c/pay/${input.customerId}/${input.priceId}`;
  }
  async createPortalSession(input: Parameters<StripeGateway["createPortalSession"]>[0]) {
    this.portalCalls.push(input);
    return `https://billing.stripe.com/p/session/${input.customerId}`;
  }
  async retrieveSubscription(subscriptionId: string) {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) throw new Error(`No such subscription: ${subscriptionId}`);
    return sub;
  }
  async latestSubscriptionOf(customerId: string) {
    const subs = [...this.subscriptions.values()].filter((s) => s.customerId === customerId);
    return subs.at(-1) ?? null;
  }
  async cancelSubscription(subscriptionId: string) {
    if (this.cancelShouldFail) throw new Error("stripe down");
    this.canceled.push(subscriptionId);
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) this.subscriptions.set(subscriptionId, { ...sub, status: "canceled" });
  }
  async deleteCustomer(customerId: string) {
    if (this.deleteCustomerShouldFail) throw new Error("stripe down (customer)");
    this.deletedCustomers.push(customerId);
    this.customers.delete(customerId);
  }
  async constructWebhookEvent(rawBody: string, signature: string) {
    const event = await Stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
    return summarizeEvent(event);
  }

  // 購読を「Stripe 側に」置く。customer の metadata.couple_id は customers から
  putSubscription(id: string, customerId: string, status: string, currentPeriodEnd: number | null, cancelAt: number | null = null) {
    const coupleId = this.customers.get(customerId)?.coupleId ?? null;
    this.subscriptions.set(id, { id, customerId, coupleId, status, currentPeriodEnd, cancelAt });
  }
}

let fake: FakeStripe;
function billingOf(gateway: StripeGateway = fake): BillingContext {
  return { gateway, priceMonthly: PRICE_MONTHLY, priceYearly: PRICE_YEARLY, appOrigin: APP_ORIGIN };
}

type TestUser = { id: string; name: string; email: string };
let userSeq = 0;

async function createUser(): Promise<TestUser> {
  userSeq += 1;
  const id = `user-${userSeq}-${crypto.randomUUID()}`;
  const name = `テストユーザー${userSeq}`;
  const email = `user-${userSeq}-${crypto.randomUUID()}@example.com`;
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
      )
      .bind(id, name, email, now),
    db
      .prepare(
        "INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at) VALUES (?1, 'google', ?2, 'google', ?3, ?4, ?4)",
      )
      .bind(crypto.randomUUID(), `google-sub-${id}`, id, now),
  ]);
  return { id, name, email };
}

// billing: null で「Stripe が設定されていない環境」（undefined は既定値に化けるので null で表す）
function contextFor(user: TestUser | null, demoCoupleId: string | null = null, billing: BillingContext | null = billingOf()): RpcContext {
  return {
    db,
    bucket,
    r2Sign,
    aiEnv: { provider: "openai", openaiApiKey: "test-openai-key" },
    billing: billing ?? undefined,
    user: user ? { ...user, image: null } : null,
    ip: "203.0.113.1",
    demoCoupleId,
    sessionCreatedAt: user ? Date.now() : null,
    authSecret: "test-secret",
  };
}

async function createPair(): Promise<{ owner: TestUser; partner: TestUser; coupleId: string }> {
  const owner = await createUser();
  const partner = await createUser();
  const couple = await call(router.couple.create, {}, { context: contextFor(owner) });
  const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
  await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
  return { owner, partner, coupleId: couple.id };
}

interface PlanRow {
  plan: string;
  source: string;
  expires_at: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_cancel_at: number | null;
}

async function planRow(coupleId: string): Promise<PlanRow | null> {
  return db
    .prepare(
      "SELECT plan, source, expires_at, stripe_customer_id, stripe_subscription_id, stripe_cancel_at FROM couple_plans WHERE couple_id = ?1",
    )
    .bind(coupleId)
    .first<PlanRow>();
}

async function setManualPlan(coupleId: string, plan: string, expiresAt: number | null = null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO couple_plans (couple_id, plan, source, expires_at, updated_at) VALUES (?1, ?2, 'manual', ?3, unixepoch())
       ON CONFLICT(couple_id) DO UPDATE SET plan = ?2, source = 'manual', expires_at = ?3, updated_at = unixepoch()`,
    )
    .bind(coupleId, plan, expiresAt)
    .run();
}

// Stripe の署名（t=<秒>,v1=<HMAC-SHA256(secret, "<秒>.<本文>") の hex>）を作る
async function sign(payload: string, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

// Stripe が送る形の event（見る部分だけ）
function subscriptionEvent(type: string, subscriptionId: string, customerId: string, eventId = `evt_${crypto.randomUUID()}`) {
  return JSON.stringify({
    id: eventId,
    object: "event",
    type,
    data: { object: { id: subscriptionId, object: "subscription", customer: customerId } },
  });
}

function checkoutCompletedEvent(subscriptionId: string | null, customerId: string) {
  return JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test", object: "checkout.session", subscription: subscriptionId, customer: customerId } },
  });
}

function invoiceEvent(type: string, subscriptionId: string, customerId: string) {
  return JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type,
    data: {
      object: {
        id: "in_test",
        object: "invoice",
        customer: customerId,
        parent: { type: "subscription_details", subscription_details: { subscription: subscriptionId } },
      },
    },
  });
}

const NOW = 1_800_000_000;
const PERIOD_END = NOW + 30 * 86400;

async function postWebhook(body: string, signature: string, billing: BillingContext = billingOf()) {
  const request = new Request("https://nisoine.com/api/stripe/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body,
  });
  return handleStripeWebhook(request, { db, billing, nowSeconds: () => NOW });
}

beforeEach(() => {
  vi.restoreAllMocks();
  fake = new FakeStripe();
  resetPricesCache();
});

describe("planFromStatus", () => {
  it("active / trialing / past_due は paid、それ以外は free", () => {
    expect(planFromStatus("active")).toBe("paid");
    expect(planFromStatus("trialing")).toBe("paid");
    expect(planFromStatus("past_due")).toBe("paid");
    for (const s of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused", "何か"]) {
      expect(planFromStatus(s), s).toBe("free");
    }
  });
});

describe("P1: Webhook の署名と冪等", () => {
  it("署名が違えば 400 で何も書かない", async () => {
    const { coupleId } = await createPair();
    const cus = await fake.createCustomer(coupleId);
    fake.putSubscription("sub_1", cus, "active", PERIOD_END);
    const body = subscriptionEvent("customer.subscription.created", "sub_1", cus);

    const wrong = await postWebhook(body, await sign(body, "whsec_other"));
    expect(wrong.status).toBe(400);
    const missing = await postWebhook(body, "");
    expect(missing.status).toBe(400);
    // 本文を書き換えたら通らない
    const tampered = await postWebhook(body.replace("sub_1", "sub_2"), await sign(body));
    expect(tampered.status).toBe(400);
    expect(await planRow(coupleId)).toBeNull();
  });

  it("正しい署名なら subscriptions.retrieve の状態で upsert する（event の中身は信じない）。同じ event を 2 回 → 結果が同じ", async () => {
    const { coupleId } = await createPair();
    const cus = await fake.createCustomer(coupleId);
    fake.putSubscription("sub_1", cus, "active", PERIOD_END);
    // event には status を書かない（書いてあっても見ない）
    const body = subscriptionEvent("customer.subscription.created", "sub_1", cus, "evt_same");

    const first = await postWebhook(body, await sign(body));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, result: "written" });
    const row1 = await planRow(coupleId);
    expect(row1).toEqual({
      plan: "paid",
      source: "stripe",
      expires_at: PERIOD_END,
      stripe_customer_id: cus,
      stripe_subscription_id: "sub_1",
      stripe_cancel_at: null,
    });

    const second = await postWebhook(body, await sign(body));
    expect(second.status).toBe(200);
    expect(await planRow(coupleId)).toEqual(row1);
  });

  it("checkout.session.completed（購読 id 付き）・invoice.paid（parent.subscription_details）からも購読に辿る", async () => {
    const { coupleId } = await createPair();
    const cus = await fake.createCustomer(coupleId);
    fake.putSubscription("sub_1", cus, "active", PERIOD_END);

    const checkout = checkoutCompletedEvent("sub_1", cus);
    expect((await postWebhook(checkout, await sign(checkout))).status).toBe(200);
    expect((await planRow(coupleId))?.plan).toBe("paid");

    fake.putSubscription("sub_1", cus, "canceled", PERIOD_END);
    const invoice = invoiceEvent("invoice.payment_failed", "sub_1", cus);
    expect((await postWebhook(invoice, await sign(invoice))).status).toBe(200);
    expect((await planRow(coupleId))?.plan).toBe("free");
  });

  it("購読 id が無い event は customer の一番新しい購読を読む。購読が無ければ 200 で無視", async () => {
    const { coupleId } = await createPair();
    const cus = await fake.createCustomer(coupleId);
    const none = checkoutCompletedEvent(null, cus);
    const res = await postWebhook(none, await sign(none));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
    expect(await planRow(coupleId)).toBeNull();

    fake.putSubscription("sub_9", cus, "active", PERIOD_END);
    const res2 = await postWebhook(none, await sign(none));
    expect(res2.status).toBe(200);
    expect((await planRow(coupleId))?.stripe_subscription_id).toBe("sub_9");
  });

  it("見ない種類の event は 200 で無視。Stripe を読みに行かない", async () => {
    const spy = vi.spyOn(fake, "retrieveSubscription");
    const body = JSON.stringify({ id: "evt_x", object: "event", type: "customer.created", data: { object: { id: "cus_x" } } });
    const res = await postWebhook(body, await sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("Stripe の読み直しで失敗したら 500（Stripe に再送させる）", async () => {
    const { coupleId } = await createPair();
    const cus = await fake.createCustomer(coupleId);
    const body = subscriptionEvent("customer.subscription.updated", "sub_missing", cus);
    await expect(postWebhook(body, await sign(body))).rejects.toThrow(/No such subscription/);
  });

  it("app.fetch 経由: 本物の gateway（STRIPE_WEBHOOK_SECRET は .dev.vars のダミー）でも署名違いは 400。設定が無ければ 404", async () => {
    const body = subscriptionEvent("customer.subscription.created", "sub_1", "cus_1");
    const bindings = env as unknown as Bindings;
    const res = await app.fetch(
      new Request("https://nisoine.com/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": await sign(body, "whsec_wrong") },
        body,
      }),
      { ...bindings, STRIPE_PRICE_MONTHLY: PRICE_MONTHLY, STRIPE_PRICE_YEARLY: PRICE_YEARLY },
    );
    expect(res.status).toBe(400);

    const unset = await app.fetch(
      new Request("https://nisoine.com/api/stripe/webhook", { method: "POST", body }),
      { ...bindings, STRIPE_SECRET_KEY: undefined },
    );
    expect(unset.status).toBe(404);
  });
});

describe("P2: 状態 → plan / expires_at", () => {
  async function pairWithSub(status: string, periodEnd: number | null = PERIOD_END) {
    const { coupleId } = await createPair();
    const cus = await fake.createCustomer(coupleId);
    fake.putSubscription("sub_1", cus, status, periodEnd);
    const body = subscriptionEvent("customer.subscription.updated", "sub_1", cus);
    expect((await postWebhook(body, await sign(body))).status).toBe(200);
    return { coupleId, cus };
  }

  it("active → paid で expires_at = current_period_end", async () => {
    const { coupleId } = await pairWithSub("active");
    expect(await planRow(coupleId)).toMatchObject({ plan: "paid", expires_at: PERIOD_END });
  });

  it("canceled → free で expires_at は残る（047 の猶予の起点）", async () => {
    const { coupleId, cus } = await pairWithSub("active");
    fake.putSubscription("sub_1", cus, "canceled", PERIOD_END);
    const body = subscriptionEvent("customer.subscription.deleted", "sub_1", cus);
    await postWebhook(body, await sign(body));
    expect(await planRow(coupleId)).toMatchObject({ plan: "free", expires_at: PERIOD_END, stripe_subscription_id: "sub_1" });
  });

  it("期間の終わりで解約（cancel_at あり・status は active）→ paid のまま。stripe_cancel_at に終了日時。couple.get の planCancelAt", async () => {
    const { owner, partner } = await createPair();
    const couple = await call(router.couple.get, undefined, { context: contextFor(owner) });
    const cus = await fake.createCustomer(couple.id);
    const end = Math.floor(Date.now() / 1000) + 86400;
    fake.putSubscription("sub_1", cus, "active", end, end);
    const body = subscriptionEvent("customer.subscription.updated", "sub_1", cus);
    await handleStripeWebhook(
      new Request("https://nisoine.com/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": await sign(body) }, body }),
      { db, billing: billingOf(), nowSeconds: () => Math.floor(Date.now() / 1000) },
    );
    expect(await planRow(couple.id)).toMatchObject({ plan: "paid", expires_at: end, stripe_cancel_at: end });
    const after = await call(router.couple.get, undefined, { context: contextFor(partner) });
    expect(after.plan).toBe("paid");
    expect(after.planCancelAt).toBe(end);

    // 解約を取り消す（Portal「サブスクを続ける」）→ cancel_at が消える
    fake.putSubscription("sub_1", cus, "active", end, null);
    const body2 = subscriptionEvent("customer.subscription.updated", "sub_1", cus);
    await handleStripeWebhook(
      new Request("https://nisoine.com/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": await sign(body2) }, body: body2 }),
      { db, billing: billingOf(), nowSeconds: () => Math.floor(Date.now() / 1000) },
    );
    expect((await planRow(couple.id))?.stripe_cancel_at).toBeNull();
  });

  it("past_due → paid のまま", async () => {
    const { coupleId } = await pairWithSub("past_due");
    expect(await planRow(coupleId)).toMatchObject({ plan: "paid", expires_at: PERIOD_END });
  });

  it("current_period_end が取れないときは既存の expires_at を保つ（無期限 paid を作らない）", async () => {
    const { coupleId, cus } = await pairWithSub("active");
    fake.putSubscription("sub_1", cus, "active", null);
    const body = subscriptionEvent("customer.subscription.updated", "sub_1", cus);
    await postWebhook(body, await sign(body));
    expect(await planRow(coupleId)).toMatchObject({ plan: "paid", expires_at: PERIOD_END });
  });

  it("couple.get: paid・planSource='stripe'・planExpiresAt = current_period_end", async () => {
    const { owner, partner } = await createPair();
    const couple = await call(router.couple.get, undefined, { context: contextFor(owner) });
    const cus = await fake.createCustomer(couple.id);
    // 時刻は 1 度だけ取る（Date.now() を別々に呼ぶと、秒の境目をまたいで 1 秒ずれることがある）
    const now = Math.floor(Date.now() / 1000);
    fake.putSubscription("sub_1", cus, "active", now + 86400);
    const body = subscriptionEvent("customer.subscription.created", "sub_1", cus);
    const request = new Request("https://nisoine.com/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": await sign(body) },
      body,
    });
    await handleStripeWebhook(request, { db, billing: billingOf(), nowSeconds: () => now });

    const after = await call(router.couple.get, undefined, { context: contextFor(partner) });
    expect(after.plan).toBe("paid");
    expect(after.planSource).toBe("stripe");
    expect(after.planExpiresAt).toBe(now + 86400);
    expect(after.albumQuota).toBeNull();
  });
});

describe("P3: source='manual' の行は Webhook が触らない", () => {
  it("manual の paid に Stripe の canceled が来ても paid のまま。manual の free も変わらない", async () => {
    const { coupleId } = await createPair();
    await setManualPlan(coupleId, "paid", null);
    const cus = await fake.createCustomer(coupleId);
    fake.putSubscription("sub_1", cus, "canceled", PERIOD_END);
    const body = subscriptionEvent("customer.subscription.deleted", "sub_1", cus);
    const res = await postWebhook(body, await sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, result: "skipped_manual" });
    expect(await planRow(coupleId)).toMatchObject({ plan: "paid", source: "manual", expires_at: null, stripe_subscription_id: null });

    await setManualPlan(coupleId, "free", null);
    fake.putSubscription("sub_1", cus, "active", PERIOD_END);
    await postWebhook(body, await sign(body));
    expect(await planRow(coupleId)).toMatchObject({ plan: "free", source: "manual" });
  });

  it("このアプリが作った customer ではない（metadata に couple_id が無い）購読は書かない", async () => {
    fake.subscriptions.set("sub_x", { id: "sub_x", customerId: "cus_foreign", coupleId: null, status: "active", currentPeriodEnd: PERIOD_END, cancelAt: null });
    const body = subscriptionEvent("customer.subscription.created", "sub_x", "cus_foreign");
    const res = await postWebhook(body, await sign(body));
    expect(await res.json()).toEqual({ received: true, result: "skipped_no_couple" });
  });

  it("applySubscriptionSnapshot を直接: 同じ snapshot を 2 回で同じ行", async () => {
    const { coupleId } = await createPair();
    const snap: SubscriptionSnapshot = { id: "sub_d", customerId: "cus_d", coupleId, status: "active", currentPeriodEnd: PERIOD_END, cancelAt: null };
    expect(await applySubscriptionSnapshot(db, fake, snap, NOW)).toBe("written");
    const a = await planRow(coupleId);
    expect(await applySubscriptionSnapshot(db, fake, snap, NOW + 10)).toBe("written");
    expect(await planRow(coupleId)).toEqual(a);
  });
});

// 行に付いた購読と違う購読の snapshot（0節 #9 の後半）
describe("P2b: 行に付いた購読と違う購読（2 本目・遅れて届いた古い event）", () => {
  async function pairWithSub1() {
    const { coupleId } = await createPair();
    const cus = await fake.createCustomer(coupleId);
    fake.putSubscription("sub_1", cus, "active", PERIOD_END);
    const body = subscriptionEvent("customer.subscription.created", "sub_1", cus);
    expect((await postWebhook(body, await sign(body))).status).toBe(200);
    expect(await planRow(coupleId)).toMatchObject({ plan: "paid", stripe_subscription_id: "sub_1" });
    return { coupleId, cus };
  }

  it("(a) 2 本目が active で来たら、古い方を Stripe で解約して行は新しい方になる", async () => {
    const { coupleId, cus } = await pairWithSub1();
    fake.putSubscription("sub_2", cus, "active", PERIOD_END + 100);
    const body = subscriptionEvent("customer.subscription.created", "sub_2", cus);
    const res = await postWebhook(body, await sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, result: "written_replaced_subscription" });
    expect(fake.canceled).toEqual(["sub_1"]);
    expect(await planRow(coupleId)).toMatchObject({ plan: "paid", expires_at: PERIOD_END + 100, stripe_subscription_id: "sub_2" });

    // 古い方の解約は冪等（もう canceled なら呼ばない）。同じ event をもう 1 度
    const again = await postWebhook(body, await sign(body));
    expect(await again.json()).toEqual({ received: true, result: "written" });
    expect(fake.canceled).toEqual(["sub_1"]);
  });

  it("(b) 古い購読の canceled が遅れて届いても、新しい paid の行を free に落とさない", async () => {
    const { coupleId, cus } = await pairWithSub1();
    fake.putSubscription("sub_2", cus, "active", PERIOD_END + 100);
    const b2 = subscriptionEvent("customer.subscription.created", "sub_2", cus);
    await postWebhook(b2, await sign(b2));
    // sub_1 は (a) で canceled になっている。その deleted が今届く
    const b1 = subscriptionEvent("customer.subscription.deleted", "sub_1", cus);
    const res = await postWebhook(b1, await sign(b1));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, result: "skipped_other_subscription" });
    expect(await planRow(coupleId)).toMatchObject({ plan: "paid", stripe_subscription_id: "sub_2", expires_at: PERIOD_END + 100 });
  });

  it("(c) 行の購読自身の canceled は free になる（P2 のまま）", async () => {
    const { coupleId, cus } = await pairWithSub1();
    fake.putSubscription("sub_1", cus, "canceled", PERIOD_END);
    const body = subscriptionEvent("customer.subscription.deleted", "sub_1", cus);
    await postWebhook(body, await sign(body));
    expect(await planRow(coupleId)).toMatchObject({ plan: "free", stripe_subscription_id: "sub_1" });
  });

  it("(d) 古い方の解約に失敗したら 500（Stripe が再送）。行は古い方のまま", async () => {
    const { coupleId, cus } = await pairWithSub1();
    fake.putSubscription("sub_2", cus, "active", PERIOD_END + 100);
    fake.cancelShouldFail = true;
    const body = subscriptionEvent("customer.subscription.created", "sub_2", cus);
    await expect(postWebhook(body, await sign(body))).rejects.toThrow(/stripe down/);
    expect(await planRow(coupleId)).toMatchObject({ plan: "paid", stripe_subscription_id: "sub_1" });
  });

  it("(e) 行に購読が無い（customer だけ。Checkout 直後）なら、どの購読でもそのまま書く", async () => {
    const { owner, coupleId } = await createPair();
    await call(router.billing.createCheckoutSession, { interval: "month" }, { context: contextFor(owner) });
    const cus = (await planRow(coupleId))!.stripe_customer_id!;
    fake.putSubscription("sub_9", cus, "active", PERIOD_END);
    const body = subscriptionEvent("customer.subscription.created", "sub_9", cus);
    expect(await (await postWebhook(body, await sign(body))).json()).toEqual({ received: true, result: "written" });
    expect(fake.canceled).toEqual([]);
    expect(await planRow(coupleId)).toMatchObject({ plan: "paid", stripe_subscription_id: "sub_9" });
  });
});

describe("P4: billing.createCheckoutSession", () => {
  it("free のペア: customer を作って先に couple_plans に free/stripe で保存し、Checkout の URL を返す。Stripe に渡すのは couple_id だけ", async () => {
    const { owner, coupleId } = await createPair();
    const { url } = await call(router.billing.createCheckoutSession, { interval: "month" }, { context: contextFor(owner) });
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const row = await planRow(coupleId);
    expect(row).toMatchObject({ plan: "free", source: "stripe", stripe_subscription_id: null });
    expect(row?.stripe_customer_id).toMatch(/^cus_/);
    expect(fake.customers.get(row!.stripe_customer_id!)).toEqual({ coupleId });

    expect(fake.checkoutCalls).toHaveLength(1);
    const c = fake.checkoutCalls[0]!;
    expect(c).toEqual({
      customerId: row!.stripe_customer_id,
      priceId: PRICE_MONTHLY,
      coupleId,
      successUrl: `${APP_ORIGIN}/app/premium?status=success`,
      cancelUrl: `${APP_ORIGIN}/app/premium`,
    });
    // 名前・メールが混ざっていない
    const sent = JSON.stringify(c);
    expect(sent).not.toContain(owner.email);
    expect(sent).not.toContain(owner.name);
  });

  it("year は年額の Price。2 回目は customer を作り直さない", async () => {
    const { owner, coupleId } = await createPair();
    await call(router.billing.createCheckoutSession, { interval: "month" }, { context: contextFor(owner) });
    await call(router.billing.createCheckoutSession, { interval: "year" }, { context: contextFor(owner) });
    expect(fake.customers.size).toBe(1);
    expect(fake.checkoutCalls[1]?.priceId).toBe(PRICE_YEARLY);
    expect((await planRow(coupleId))?.stripe_customer_id).toBe(fake.checkoutCalls[0]?.customerId);
  });

  it("既に paid（manual でも stripe でも）なら CONFLICT", async () => {
    const { owner, coupleId } = await createPair();
    await setManualPlan(coupleId, "paid", null);
    await expect(
      call(router.billing.createCheckoutSession, { interval: "month" }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fake.customers.size).toBe(0);

    // 期限切れの paid は free 扱いなので通る
    await setManualPlan(coupleId, "paid", Math.floor(Date.now() / 1000) - 1);
    const { url } = await call(router.billing.createCheckoutSession, { interval: "month" }, { context: contextFor(owner) });
    expect(url).toBeTruthy();
  });

  it("ゲスト（未認証）は FORBIDDEN。ペア未所属は NEEDS_ONBOARDING", async () => {
    await expect(
      call(router.billing.createCheckoutSession, { interval: "month" }, { context: contextFor(null, "demo-couple") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const alone = await createUser();
    await expect(
      call(router.billing.createCheckoutSession, { interval: "month" }, { context: contextFor(alone) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("Stripe が設定されていない環境では 500（黙って通さない）", async () => {
    const { owner } = await createPair();
    await expect(
      call(router.billing.createCheckoutSession, { interval: "month" }, { context: contextFor(owner, null, null) }),
    ).rejects.toThrow(/Stripe が設定されていません/);
  });
});

describe("P5: billing.createPortalSession", () => {
  it("stripe_customer_id が無ければ NOT_FOUND（行無し・manual）", async () => {
    const { owner, coupleId } = await createPair();
    await expect(call(router.billing.createPortalSession, {}, { context: contextFor(owner) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await setManualPlan(coupleId, "paid", null);
    await expect(call(router.billing.createPortalSession, {}, { context: contextFor(owner) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.portalCalls).toHaveLength(0);
  });

  it("自分のペアの customer で Portal を作る。return_url は /app/profile。他ペアの customer は使えない", async () => {
    const a = await createPair();
    const b = await createPair();
    await call(router.billing.createCheckoutSession, { interval: "month" }, { context: contextFor(a.owner) });
    const aCustomer = (await planRow(a.coupleId))!.stripe_customer_id!;

    const { url } = await call(router.billing.createPortalSession, {}, { context: contextFor(a.partner) });
    expect(url).toBe(`https://billing.stripe.com/p/session/${aCustomer}`);
    expect(fake.portalCalls[0]).toEqual({ customerId: aCustomer, returnUrl: `${APP_ORIGIN}/app/profile` });

    // b のペアは自分の行に customer が無いので NOT_FOUND（a の customer には辿れない）
    await expect(call(router.billing.createPortalSession, {}, { context: contextFor(b.owner) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.portalCalls).toHaveLength(1);
  });

  it("ゲストは FORBIDDEN", async () => {
    await expect(call(router.billing.createPortalSession, {}, { context: contextFor(null, "demo-couple") })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("billing.prices", () => {
  it("2 つの価格を Stripe から読み、1 時間はキャッシュする。ゲストも読める", async () => {
    const spy = vi.spyOn(fake, "retrievePrice");
    const prices = await call(router.billing.prices, {}, { context: contextFor(null, "demo-couple") });
    expect(prices).toEqual({
      monthly: { amount: 420, currency: "jpy", priceId: PRICE_MONTHLY },
      yearly: { amount: 4200, currency: "jpy", priceId: PRICE_YEARLY },
    });
    expect(spy).toHaveBeenCalledTimes(2);
    await call(router.billing.prices, {}, { context: contextFor(null, "demo-couple") });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("P8: me.delete は Stripe の購読を先に解約する", () => {
  it("購読が生きていれば解約してから行を消す", async () => {
    const { owner, coupleId } = await createPair();
    const cus = await fake.createCustomer(coupleId);
    fake.putSubscription("sub_1", cus, "active", PERIOD_END);
    const body = subscriptionEvent("customer.subscription.created", "sub_1", cus);
    await postWebhook(body, await sign(body));

    await call(router.me.delete, undefined, { context: contextFor(owner) });
    expect(fake.canceled).toEqual(["sub_1"]);
    // 解約のあと customer も消す（順序: 解約 → customer）
    expect(fake.deletedCustomers).toEqual([cus]);
    expect(await planRow(coupleId)).toBeNull();
    const user = await db.prepare("SELECT id FROM user WHERE id = ?1").bind(owner.id).first();
    expect(user).toBeNull();
  });

  it("customer の削除に失敗しても退会は止めない（購読の解約は済んでいる）", async () => {
    const { owner, coupleId } = await createPair();
    const cus = await fake.createCustomer(coupleId);
    fake.putSubscription("sub_1", cus, "active", PERIOD_END);
    const body = subscriptionEvent("customer.subscription.created", "sub_1", cus);
    await postWebhook(body, await sign(body));

    fake.deleteCustomerShouldFail = true;
    await call(router.me.delete, undefined, { context: contextFor(owner) });
    expect(fake.canceled).toEqual(["sub_1"]);
    expect(fake.deletedCustomers).toEqual([]);
    expect(await planRow(coupleId)).toBeNull();
    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(owner.id).first()).toBeNull();
  });

  it("購読は無いが customer はある（Checkout の途中でやめた）: customer だけ消して退会", async () => {
    const { owner, coupleId } = await createPair();
    await call(router.billing.createCheckoutSession, { interval: "month" }, { context: contextFor(owner) });
    const cus = (await planRow(coupleId))!.stripe_customer_id!;
    await call(router.me.delete, undefined, { context: contextFor(owner) });
    expect(fake.canceled).toEqual([]);
    expect(fake.deletedCustomers).toEqual([cus]);
    expect(await planRow(coupleId)).toBeNull();
  });

  it("解約に失敗したら退会を止める（行もユーザーも残る）", async () => {
    const { owner, coupleId } = await createPair();
    const cus = await fake.createCustomer(coupleId);
    fake.putSubscription("sub_1", cus, "active", PERIOD_END);
    const body = subscriptionEvent("customer.subscription.created", "sub_1", cus);
    await postWebhook(body, await sign(body));

    fake.cancelShouldFail = true;
    const result = await call(router.me.delete, undefined, { context: contextFor(owner) }).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(Error);
    expect(result).not.toBeInstanceOf(ORPCError);
    expect((await planRow(coupleId))?.plan).toBe("paid");
    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(owner.id).first()).not.toBeNull();
  });

  it("購読が無い（manual・行無し）なら Stripe を呼ばずに退会できる", async () => {
    const { owner, coupleId } = await createPair();
    await setManualPlan(coupleId, "paid", null);
    await call(router.me.delete, undefined, { context: contextFor(owner, null, null) });
    expect(fake.canceled).toEqual([]);
    expect(await planRow(coupleId)).toBeNull();
  });
});

describe("createStripeGateway", () => {
  it("鍵が無ければ作れない", () => {
    expect(() => createStripeGateway({})).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("Webhook の秘密が無ければ署名の検証で落ちる（通さない）", async () => {
    const gateway = createStripeGateway({ secretKey: "sk_test_x" });
    await expect(gateway.constructWebhookEvent("{}", "t=1,v1=00")).rejects.toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});

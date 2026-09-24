// Stripe の Webhook（POST /api/stripe/webhook）。oRPC の外（Hono に直接。048）。
//
// - 生のボディで署名を確かめる（署名が違えば 400）。それ以外の認証は無い（Stripe から来る）
// - 見る event: checkout.session.completed・customer.subscription.created/updated/deleted・
//   invoice.paid・invoice.payment_failed。それ以外は 200 で無視
// - どの event でも、購読の今の状態を Stripe に読み直して upsert する
//   （event の中身を信じず、順序に依存しない。同じ event が 2 回来ても結果が同じ。lib/billing.ts）
// - source='manual' の行は書かない
// - 行に付いた購読と違う購読: paid なら 2 本目（古い方を解約して差し替え）、paid でなければ書かない（lib/billing.ts）
// - 失敗（D1 が落ちた等）は 500 を返して Stripe に再送させる。成功したら 200
// - ログは event の種類と couple_id の先頭だけ（security-requirements.md 8節）
import type { BillingContext } from "./lib/billing";
import { applySubscriptionSnapshot } from "./lib/billing";
import type { SubscriptionSnapshot } from "./lib/stripe";

const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

export interface WebhookDeps {
  db: D1Database;
  billing: BillingContext;
  nowSeconds: () => number;
  log?: (line: string) => void;
}

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : "-";
}

export async function handleStripeWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  // 署名は生のボディに対して計算される。JSON にしてから戻すと空白が変わって一致しない
  const rawBody = await request.text();
  let event;
  try {
    event = await deps.billing.gateway.constructWebhookEvent(rawBody, signature);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return Response.json({ received: true, ignored: true });
  }

  // 購読の今の状態を Stripe に読み直す。event に購読 id が無ければ customer の一番新しい購読
  let snapshot: SubscriptionSnapshot | null = null;
  if (event.subscriptionId) {
    snapshot = await deps.billing.gateway.retrieveSubscription(event.subscriptionId);
  } else if (event.customerId) {
    snapshot = await deps.billing.gateway.latestSubscriptionOf(event.customerId);
  }
  if (!snapshot) {
    // 購読に辿れない（checkout.session.completed で mode=payment 等）。書くものが無い
    deps.log?.(`stripe webhook ${event.type}: no subscription`);
    return Response.json({ received: true, ignored: true });
  }

  const result = await applySubscriptionSnapshot(deps.db, deps.billing.gateway, snapshot, deps.nowSeconds(), deps.log);
  deps.log?.(`stripe webhook ${event.type}: couple=${shortId(snapshot.coupleId)} status=${snapshot.status} ${result}`);
  return Response.json({ received: true, result });
}

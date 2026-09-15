// 048 段階2: ローカルの一周で、Stripe からの Webhook を代わりに届ける（Stripe CLI を入れない）。
// 鍵は apps/api/.dev.vars から読む（画面に出さない）。本番では使わない。
//
// 使い方（リポジトリの根で）:
//   node artifacts/048/scripts/relay-webhook.mjs list                 # 購読の一覧（id・status・customer・期限）
//   node artifacts/048/scripts/relay-webhook.mjs relay <type> <sub_id> # 署名した event を localhost:8787 の Webhook へ
//   node artifacts/048/scripts/relay-webhook.mjs cancel <sub_id>       # Stripe で即時解約 → customer.subscription.deleted を届ける
//   node artifacts/048/scripts/relay-webhook.mjs plan <couple_id>      # ローカル D1 の couple_plans の行（wrangler d1 execute）
//
// Worker は event の中身を信じず Stripe に読み直す（stripe-webhook.ts）ので、届ける event は種類と購読 id だけでよい
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const devVars = readFileSync(path.join(repoRoot, "apps", "api", ".dev.vars"), "utf8");
function readVar(name) {
  const m = devVars.match(new RegExp(`^${name}=(.+)$`, "m"));
  if (!m) throw new Error(`${name} が apps/api/.dev.vars に無い`);
  return m[1].trim();
}
const SECRET_KEY = readVar("STRIPE_SECRET_KEY");
const WEBHOOK_SECRET = readVar("STRIPE_WEBHOOK_SECRET");
const WEBHOOK_URL = "http://localhost:8787/api/stripe/webhook";

async function stripe(method, pathname, body) {
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${SECRET_KEY}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${pathname}: ${res.status} ${json.error?.message ?? ""}`);
  return json;
}

function summarize(sub) {
  const ends = (sub.items?.data ?? []).map((i) => i.current_period_end).filter((n) => typeof n === "number");
  return {
    id: sub.id,
    status: sub.status,
    customer: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    cancel_at_period_end: sub.cancel_at_period_end,
    cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
    current_period_end: ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : null,
    couple_id: sub.metadata?.couple_id ?? null,
  };
}

function sign(payload) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

async function relay(type, subId, customerId) {
  const payload = JSON.stringify({
    id: `evt_relay_${Date.now()}`,
    object: "event",
    type,
    data: { object: { id: subId, object: "subscription", customer: customerId } },
  });
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sign(payload) },
    body: payload,
  });
  console.log(`relay ${type} ${subId} → ${res.status} ${await res.text()}`);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "list") {
  const list = await stripe("GET", "/subscriptions?status=all&limit=10");
  for (const sub of list.data) console.log(JSON.stringify(summarize(sub)));
} else if (cmd === "relay") {
  const sub = await stripe("GET", `/subscriptions/${b}`);
  await relay(a, sub.id, typeof sub.customer === "string" ? sub.customer : sub.customer.id);
} else if (cmd === "cancel") {
  const sub = await stripe("DELETE", `/subscriptions/${a}`);
  console.log(JSON.stringify(summarize(sub)));
  await relay("customer.subscription.deleted", sub.id, typeof sub.customer === "string" ? sub.customer : sub.customer.id);
} else if (cmd === "plan") {
  const out = execFileSync(
    process.execPath,
    [
      path.join(repoRoot, "apps", "api", "node_modules", "wrangler", "bin", "wrangler.js"),
      "d1",
      "execute",
      "DB",
      "--local",
      "--json",
      "--command",
      `SELECT couple_id, plan, source, expires_at, stripe_customer_id, stripe_subscription_id FROM couple_plans WHERE couple_id = '${a.replace(/'/g, "")}'`,
    ],
    { cwd: path.join(repoRoot, "apps", "api"), encoding: "utf8" },
  );
  console.log(out.slice(0, 2000));
} else {
  console.log("usage: list | relay <type> <sub_id> | cancel <sub_id> | plan <couple_id>");
  process.exit(1);
}

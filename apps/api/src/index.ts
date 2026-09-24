import { Hono } from "hono";
import { cors } from "hono/cors";
import { RPCHandler } from "@orpc/server/fetch";
import { StrictGetMethodPlugin } from "@orpc/server/plugins";
import { router } from "./router";
import type { RpcContext } from "./context";
import { createAuth, parseTrustedOrigins } from "./auth";
import { canonicalUrlFor, isLegacyHost, LEGACY_ORIGIN_MESSAGE } from "./lib/canonical-host";
import { withErrorId } from "./lib/error-id";
import { applyStaticSecurityHeaders, withContentSecurityPolicy } from "./lib/security-headers";
import { createStripeGateway } from "./lib/stripe";
import type { BillingContext } from "./lib/billing";
import { handleStripeWebhook } from "./stripe-webhook";
import { parseAdminEmails } from "./lib/admin-emails";

export interface Bindings {
  DB: D1Database;
  BUCKET: R2Bucket;
  // 静的アセット（apps/api/public）。run_worker_first なので全リクエストが Worker に届き、
  // /api/* 以外をここへ渡す。テスト環境では無いことがある（無ければ 404）
  ASSETS?: Fetcher;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // カンマ区切り。Cookie 付きの越境を許すオリジン（本番は同一オリジンなので空でよい）
  TRUSTED_ORIGINS?: string;
  // デモペアの couple_id（architecture.md 8節）
  DEMO_COUPLE_ID?: string;
  // クライアントに渡す署名付き URL を組み立てる鍵（R2 の S3 互換 API のトークン）。
  // Worker から直接操作する env.BUCKET とは別物
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  // AI_PROVIDER が指す方のキーだけを読む（lib/ai.ts。037）
  AI_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  // Stripe。鍵 2 つは secret、Price ID は [vars]（秘密ではない）
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // 運営のメール（カンマ区切り。wrangler secret）
  ADMIN_EMAILS?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
}

// 鍵か Price ID が無ければ undefined（billing.* だけが 500 になり、他は影響を受けない）。
// gateway はリクエストごとに作る（軽い。secret の更新がデプロイ無しで効く）
function buildBilling(env: Bindings): BillingContext | undefined {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_MONTHLY || !env.STRIPE_PRICE_YEARLY || !env.BETTER_AUTH_URL) {
    return undefined;
  }
  return {
    gateway: createStripeGateway({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET }),
    priceMonthly: env.STRIPE_PRICE_MONTHLY,
    priceYearly: env.STRIPE_PRICE_YEARLY,
    // 末尾の / は付けない（`${appOrigin}/app/premium` と繋ぐ）
    appOrigin: env.BETTER_AUTH_URL.replace(/\/+$/, ""),
  };
}

// wrangler.toml の [[r2_buckets]] bucket_name と一致させる
const R2_BUCKET_NAME = "futary-images";

const app = new Hono<{ Bindings: Bindings }>();

// GET で手続きを実行させない（状態変更を GET で行わない。security-requirements.md 7節）。
// RPCHandler は既定で StrictGetMethodPlugin を登録するが、ライブラリの既定に頼らず明示する
// （重複して 2 つになるが同じ検査なので実害は無い。method-restriction.test.ts が固定する）。
// interceptors は想定外の例外に一意の ID を振る（lib/error-id.ts）。意図した ORPCError には影響しない
const handler = new RPCHandler(router, {
  plugins: [new StrictGetMethodPlugin()],
  interceptors: [({ next }) => withErrorId(next)],
});

// 固定のセキュリティヘッダ（nosniff・Referrer-Policy・HSTS）を全応答に付ける。一番外側に置き、
// 301・403・API・静的アセットのどれにも付ける（run_worker_first では `_headers` が効かない）
app.use("*", async (c, next) => {
  await next();
  applyStaticSecurityHeaders(c.res);
});

// 旧ホスト（*.workers.dev）と www は nisoine.com へ 301（同じパス・クエリ）。
// /api/* は 301 しない: 古いタブの fetch が 301 を黙って追うと Cookie 無しの 401 になるだけなので、
// 403 と文言で「開き直して」と伝える（053）
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (!isLegacyHost(url.hostname)) {
    await next();
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    return c.json({ error: "LEGACY_ORIGIN", message: LEGACY_ORIGIN_MESSAGE }, 403);
  }
  return c.redirect(canonicalUrlFor(url), 301);
});

// Cookie 付きの越境を許すオリジンは環境変数で切り替える（本番は同一オリジンで越境しない）
app.use("/api/*", (c, next) => {
  return cors({
    origin: parseTrustedOrigins(c.env.TRUSTED_ORIGINS),
    credentials: true,
  })(c, next);
});

// @better-auth/expo の認可プロキシ。ネイティブのログインは未対応なので、オープンリダイレクトの
// 踏み台にされないよう塞ぐ。ネイティブに対応するときに外す
app.get("/api/auth/expo-authorization-proxy", (c) => c.notFound());

// Stripe の Webhook。Cookie は無く署名だけで認証するので、CORS・セッションの前に置く
// （stripe-webhook.ts）。Stripe が未設定なら 404
app.post("/api/stripe/webhook", async (c) => {
  const billing = buildBilling(c.env);
  if (!billing) return c.notFound();
  return handleStripeWebhook(c.req.raw, {
    db: c.env.DB,
    billing,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    log: (line) => console.log(line),
  });
});

// Better Auth のルート（/api/auth/sign-in/social, /api/auth/callback/google 等）
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

app.use("/api/*", async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const user = session
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      }
    : null;
  // invite.accept のレート制限に使う IP。無ければ null（代用文字列にすると無関係な利用者を巻き込む）
  const ip = c.req.header("cf-connecting-ip") ?? null;
  // 空文字も未設定として扱う（fail-closed）
  const demoCoupleId = c.env.DEMO_COUPLE_ID ? c.env.DEMO_COUPLE_ID : null;
  const sessionCreatedAt = session ? session.session.createdAt.getTime() : null;
  // createAuth(c.env) が assertValidSecret を通しているので、ここでは確かめない
  const authSecret = c.env.BETTER_AUTH_SECRET as string;
  const r2Sign = {
    accountId: c.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: c.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY ?? "",
    bucketName: R2_BUCKET_NAME,
  };
  // AI_PROVIDER が指す方のキーだけを context に積む（使わない方の秘密を全リクエストに同居させない）
  const aiEnv = {
    provider: c.env.AI_PROVIDER,
    openaiApiKey: c.env.AI_PROVIDER === "openai" ? c.env.OPENAI_API_KEY : undefined,
    anthropicApiKey: c.env.AI_PROVIDER === "anthropic" ? c.env.ANTHROPIC_API_KEY : undefined,
  };
  const context: RpcContext = {
    db: c.env.DB,
    bucket: c.env.BUCKET,
    r2Sign,
    aiEnv,
    billing: buildBilling(c.env),
    adminEmails: parseAdminEmails(c.env.ADMIN_EMAILS),
    user,
    ip,
    demoCoupleId,
    sessionCreatedAt,
    authSecret,
  };
  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: "/api",
    context,
  });
  if (matched) {
    return c.newResponse(response.body, response);
  }
  await next();
});

// /api/* 以外は静的アセット（html_handling・404 は binding の既定のまま）。HTML には CSP を付ける
// （inline script のハッシュは配信する HTML から計算。lib/security-headers.ts）。
// /api/* で一致しなかったものは binding に渡さず 404
app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.notFound();
  const assets = c.env.ASSETS;
  if (!assets) return c.notFound();
  const res = await assets.fetch(c.req.raw);
  return withContentSecurityPolicy(res, c.req.path, c.env.R2_ACCOUNT_ID);
});

export default app;

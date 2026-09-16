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
  // 053: 静的アセット（apps/api/public。wrangler.toml の [assets]）。run_worker_first = true
  // なので全リクエストが Worker に届き、/api/* 以外はこの binding に渡す。
  // テスト環境で無いことがあるため optional（無ければ 404）
  ASSETS?: Fetcher;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // カンマ区切り。Cookie を使う認証で `credentials: true` を許可するオリジンを
  // 環境ごとに切り替える（本番は同一オリジン配信のため空でよい）
  TRUSTED_ORIGINS?: string;
  // デモペアの couple_id。014 でデモペアを作るまでは空文字（architecture.md 8節）
  DEMO_COUPLE_ID?: string;
  // R2 の S3互換API を署名するための認証情報（Cloudflareダッシュボードの
  // 「R2 > Manage R2 API Tokens」で発行する。env.BUCKET のバインディングとは別物で、
  // バインディングは Worker 内から直接オブジェクトを操作するためのもの、
  // こちらはクライアントに渡す署名付きURLを組み立てるための鍵）
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  // 037: AIまとめ。AI_PROVIDERが指す方のキーだけを読む（apps/api/src/lib/ai.ts）。
  // 両方を同時に読まない（タスク定義3節）
  AI_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  // 048 段階2: Stripe。鍵 2 つは secret、Price ID は [vars]（秘密ではない）
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // 057: 運営のメール（カンマ区切り。wrangler secret。ローカルは .dev.vars）
  ADMIN_EMAILS?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
}

// 048 段階2: Stripe の窓口。鍵か Price ID が無ければ undefined（billing.* を呼ぶと 500。
// 他の手続きは影響を受けない）。gateway はリクエストごとに作る（SDK のクライアントは軽い。
// secret の更新がデプロイ無しで効く）
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

// @orpc/server の RPCHandler は既定（`strictGetMethodPluginEnabled` を渡さない場合）で
// StrictGetMethodPlugin を自動登録しており、GET経由での手続き実行は元々拒否されている
// （@orpc/server/dist/adapters/fetch/index.mjs で実装を確認済み）。
// 009 の M2まとめ監査時、この既定値を確認せずに「GETが通ってしまう」という誤った
// High指摘が出て一時 CSRF 脆弱性ありと記録したが、実測（curlでのGET確認）は
// 既にこの時点で 405 を返しており、指摘そのものが誤りだった（fix/reject-get-writes・
// Rレビューで判明。security-requirements.md 7節「状態変更をGETで行わない」は
// 元々満たされていた）。ここで明示的に登録しているのは「ライブラリの既定に依存しない」
// ためで、上のコンストラクタ内の自動登録と合わせて StrictGetMethodPlugin が2つ
// 登録される（意図的な重複。両方とも同じ検査をするだけで実害は無い）。
// 回帰テスト（apps/api/test/method-restriction.test.ts）はこの動作を固定する
// interceptorsは想定外の例外（procedureのバグ・DBエラー等）を捕まえて
// 一意のIDを振るために使う（apps/api/src/lib/error-id.ts）。procedure側が
// 意図的にthrowするFORBIDDEN等のORPCErrorには影響しない
const handler = new RPCHandler(router, {
  plugins: [new StrictGetMethodPlugin()],
  interceptors: [({ next }) => withErrorId(next)],
});

// 053: 固定のセキュリティヘッダ（nosniff・Referrer-Policy・HSTS）を全応答に付ける。
// 一番外側に置く: 下の 301・403・API・静的アセットのどの応答にも付く。
// `_headers` は run_worker_first = true だと効かないため Worker で付ける
// （src/lib/security-headers.ts）。静的アセットの応答は下の fallback で複製済み
// （binding の応答はヘッダが immutable）
app.use("*", async (c, next) => {
  await next();
  applyStaticSecurityHeaders(c.res);
});

// 053: 旧ホスト（*.workers.dev）と www は nisoine.com へ 301（同じパス・同じクエリ）。
// /api/* は 301 しない: 開きっぱなしの古いタブからの API 呼び出しは fetch が 301 を
// 黙って追って Cookie 無しの 401 になるだけなので、403 と文言で「開き直して」と伝える
// （タスク定義 0節 #2）。ローカル（localhost）は isLegacyHost が false で素通り
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

// 認証情報（Cookie）付きリクエストを許可するオリジンは環境変数で切り替える。
// 本番は同一Workerから配信するため同一オリジンになり、そもそも越境しない
app.use("/api/*", (c, next) => {
  return cors({
    origin: parseTrustedOrigins(c.env.TRUSTED_ORIGINS),
    credentials: true,
  })(c, next);
});

// @better-auth/expo の認可プロキシ。ネイティブの Google ログインは未対応
// （futary:// を TRUSTED_ORIGINS に含めていない）ため、オープンリダイレクトの
// 踏み台にされないよう明示的に塞ぐ。ネイティブ対応時にこのブロックを外す
// （security-auditor 003監査 Medium指摘）
app.get("/api/auth/expo-authorization-proxy", (c) => c.notFound());

// 048 段階2: Stripe の Webhook。CORS・セッションの前に置く（Stripe からの POST に Cookie は無い。
// 署名だけで認証する。stripe-webhook.ts）。Stripe が設定されていなければ 404
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
  // invite.accept のレート制限に使うIP。Cloudflare が付与するヘッダで、
  // ローカル開発等で無い場合は null（IP条件を外し user_id 単独で判定する。
  // 固定の代用文字列に丸めると無関係な利用者を巻き込むため、そうしていない）
  const ip = c.req.header("cf-connecting-ip") ?? null;
  // 空文字も「未設定」として扱う（fail-closed。docs/tasks/005-authorization-middleware.md）
  const demoCoupleId = c.env.DEMO_COUPLE_ID ? c.env.DEMO_COUPLE_ID : null;
  const sessionCreatedAt = session ? session.session.createdAt.getTime() : null;
  // createAuth(c.env) が既に assertValidSecret を通しているため、ここでは
  // undefinedチェックをしない（auth.tsのコメント参照）
  const authSecret = c.env.BETTER_AUTH_SECRET as string;
  const r2Sign = {
    accountId: c.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: c.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY ?? "",
    bucketName: R2_BUCKET_NAME,
  };
  // security-auditor指摘: AI_PROVIDERが指す方だけをcontextに積む
  // （タスク定義3節「両方のキーを同時に読まない」）。実際に選ぶのは
  // lib/ai.tsのresolveAiConfigだが、使わない方の秘密が全リクエストの
  // contextに同居しない方が、将来contextをログ・トレースへ流したときに
  // 一度に2本漏れる形にならない
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

// 053: /api/* 以外は静的アセット（ランディング・/app/*）。run_worker_first = true に
// したので Worker が ASSETS binding に渡す（html_handling・404 は binding 側の既定
// のまま。`/privacy` -> privacy.html の解決も変わらない）。HTML には CSP を付ける
// （inline script のハッシュは配信する HTML から計算。src/lib/security-headers.ts）。
// /api/* で一致しなかったものは binding に渡さず 404（それまでの Hono の既定と同じ）
app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.notFound();
  const assets = c.env.ASSETS;
  if (!assets) return c.notFound();
  const res = await assets.fetch(c.req.raw);
  return withContentSecurityPolicy(res, c.req.path, c.env.R2_ACCOUNT_ID);
});

export default app;

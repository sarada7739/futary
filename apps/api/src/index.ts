import { Hono } from "hono";
import { cors } from "hono/cors";
import { RPCHandler } from "@orpc/server/fetch";
import { StrictGetMethodPlugin } from "@orpc/server/plugins";
import { router } from "./router";
import type { RpcContext } from "./context";
import { createAuth, parseTrustedOrigins } from "./auth";
import { withErrorId } from "./lib/error-id";

export interface Bindings {
  DB: D1Database;
  BUCKET: R2Bucket;
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

// 認証情報（Cookie）付きリクエストを許可するオリジンは環境変数で切り替える。
// 本番は同一Workerから配信するため同一オリジンになり、そもそも越境しない
app.use("/api/*", (c, next) => {
  return cors({
    origin: parseTrustedOrigins(c.env.TRUSTED_ORIGINS),
    credentials: true,
  })(c, next);
});

// `_headers`（scripts/build-public.mjs）は静的アセットのレスポンスにのみ
// 適用され、run_worker_first で /api/* はWorkerが直接応答するため対象外になる。
// CSPはJSONレスポンスに意味を持たないため付けないが、nosniffは誤った
// Content-Typeでのスニッフィング対策としてJSONにも意味があるため、
// /api/* にも明示的に付ける（security-auditor全体監査Low-3指摘）
app.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
});

// @better-auth/expo の認可プロキシ。ネイティブの Google ログインは未対応
// （futary:// を TRUSTED_ORIGINS に含めていない）ため、オープンリダイレクトの
// 踏み台にされないよう明示的に塞ぐ。ネイティブ対応時にこのブロックを外す
// （security-auditor 003監査 Medium指摘）
app.get("/api/auth/expo-authorization-proxy", (c) => c.notFound());

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
  const context: RpcContext = {
    db: c.env.DB,
    bucket: c.env.BUCKET,
    r2Sign,
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

export default app;

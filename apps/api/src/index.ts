import { Hono } from "hono";
import { cors } from "hono/cors";
import { RPCHandler } from "@orpc/server/fetch";
import { router } from "./router";
import type { RpcContext } from "./context";
import { createAuth, parseTrustedOrigins } from "./auth";

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
}

const app = new Hono<{ Bindings: Bindings }>();

const handler = new RPCHandler(router);

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
  const context: RpcContext = { db: c.env.DB, user, ip };
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

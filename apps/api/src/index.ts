import { Hono } from "hono";
import { cors } from "hono/cors";
import { RPCHandler } from "@orpc/server/fetch";
import { router, type RpcContext } from "./router";

export interface Bindings {
  DB: D1Database;
  BUCKET: R2Bucket;
}

const app = new Hono<{ Bindings: Bindings }>();

const handler = new RPCHandler(router);

// 開発時のみ: Expo Web (localhost) から別ポートのWorkerを叩くため許可する。
// 本番は同一Workerから配信するため同一オリジンになり、この設定は効かない
app.use(
  "/api/*",
  cors({
    origin: [
      "http://localhost:8081",
      "http://localhost:19006",
      "http://127.0.0.1:8081",
    ],
  }),
);

app.use("/api/*", async (c, next) => {
  const context: RpcContext = { db: c.env.DB };
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

import { implement } from "@orpc/server";
import { contract } from "@futary/contract";

export interface RpcContext {
  db: D1Database;
}

const implementer = implement(contract).$context<RpcContext>();

const healthGet = implementer.health.get.handler(async ({ context }) => {
  // D1への疎通確認。失敗すればここで例外が飛び500になる
  await context.db.prepare("SELECT 1").first();
  return { ok: true as const, now: Date.now() };
});

export const router = implementer.router({
  health: {
    get: healthGet,
  },
});

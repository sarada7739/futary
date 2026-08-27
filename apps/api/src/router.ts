import { implement } from "@orpc/server";
import { contract } from "@futary/contract";

export interface RpcContext {
  db: D1Database;
  user: { id: string; name: string; email: string; image: string | null } | null;
}

const implementer = implement(contract).$context<RpcContext>();

const healthGet = implementer.health.get.handler(async ({ context }) => {
  // D1への疎通確認。失敗すればここで例外が飛び500になる
  await context.db.prepare("SELECT 1").first();
  return { ok: true as const, now: Date.now() };
});

const meGet = implementer.me.get.handler(async ({ context }) => {
  if (!context.user) return null;
  const { id, name, email, image } = context.user;
  return { id, name, email, image: image ?? null };
});

export const router = implementer.router({
  health: {
    get: healthGet,
  },
  me: {
    get: meGet,
  },
});

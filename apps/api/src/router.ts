import { implementer } from "./implementer";
import { coupleProcedures, inviteProcedures } from "./procedures/couple";

export type { RpcContext } from "./context";

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
  couple: coupleProcedures,
  invite: inviteProcedures,
});

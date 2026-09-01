import { implementer } from "./implementer";
import { coupleProcedures, inviteProcedures } from "./procedures/couple";
import { meProcedures } from "./procedures/me";
import { postProcedures } from "./procedures/post";
import { reactionProcedures } from "./procedures/reaction";
import { eventProcedures } from "./procedures/event";
import { postUploadUrl } from "./procedures/upload";
import { statsProcedures } from "./procedures/stats";
import { memoryProcedures } from "./procedures/memory";
import { resolveUserImage } from "./lib/r2-signed-url";
import { isSessionFresh } from "./lib/reauth";

export type { RpcContext } from "./context";

const healthGet = implementer.health.get.handler(async ({ context }) => {
  // D1への疎通確認。失敗すればここで例外が飛び500になる
  await context.db.prepare("SELECT 1").first();
  return { ok: true as const, now: Date.now() };
});

const meGet = implementer.me.get.handler(async ({ context }) => {
  if (!context.user) return null;
  const { id, name, email, image } = context.user;
  // imageはGoogleの外部URLか、自分でアップロードした画像のR2キーの
  // どちらもありうる。後者だけ署名付きGET URLへ解決する（019）
  return {
    id,
    name,
    email,
    image: await resolveUserImage(context.r2Sign, image ?? null),
    sessionIsFresh: isSessionFresh(context.sessionCreatedAt),
  };
});

export const router = implementer.router({
  health: {
    get: healthGet,
  },
  me: { get: meGet, ...meProcedures },
  couple: coupleProcedures,
  invite: inviteProcedures,
  post: { ...postProcedures, uploadUrl: postUploadUrl },
  reaction: reactionProcedures,
  event: eventProcedures,
  stats: statsProcedures,
  memory: memoryProcedures,
});

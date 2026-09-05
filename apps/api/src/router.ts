import { implementer } from "./implementer";
import { coupleProcedures, inviteProcedures } from "./procedures/couple";
import { meProcedures } from "./procedures/me";
import { postProcedures } from "./procedures/post";
import { reactionProcedures } from "./procedures/reaction";
import { eventProcedures } from "./procedures/event";
import { postUploadUrl } from "./procedures/upload";
import { statsProcedures } from "./procedures/stats";
import { memoryProcedures } from "./procedures/memory";
import { wishProcedures } from "./procedures/wish";
import { moodProcedures } from "./procedures/mood";
import { aiSummaryProcedures } from "./procedures/ai-summary";
import { resolveUserImage } from "./lib/r2-signed-url";
import { isSessionFresh } from "./lib/reauth";

export type { RpcContext } from "./context";

const healthGet = implementer.health.get.handler(async ({ context }) => {
  // D1への疎通確認。失敗すればここで例外が飛び500になる
  await context.db.prepare("SELECT 1").first();
  return { ok: true as const, now: Date.now() };
});

interface AiOptInRow {
  couple_id: string;
  my_opt_in: number;
  partner_opt_in: number | null;
}

const meGet = implementer.me.get.handler(async ({ context }) => {
  if (!context.user) return null;
  const { id, name, email, image } = context.user;

  // 037: couple_membersに行が無い（ペア未所属）ならaiOptIn/partnerAiOptInは
  // 両方false。resolveCoupleContextを経由しない（未所属をNEEDS_ONBOARDINGで
  // 弾くとme.getそのものが失敗し、オンボーディング前の画面が壊れるため）
  const aiOptInRow = await context.db
    .prepare(
      `SELECT cm.couple_id AS couple_id, cm.ai_opt_in AS my_opt_in, partner.ai_opt_in AS partner_opt_in
         FROM couple_members cm
         LEFT JOIN couple_members partner
           ON partner.couple_id = cm.couple_id AND partner.user_id != cm.user_id
        WHERE cm.user_id = ?1`,
    )
    .bind(id)
    .first<AiOptInRow>();

  // imageはGoogleの外部URLか、自分でアップロードした画像のR2キーの
  // どちらもありうる。後者だけ署名付きGET URLへ解決する（019）
  return {
    id,
    name,
    email,
    image: await resolveUserImage(context.r2Sign, image ?? null),
    sessionIsFresh: isSessionFresh(context.sessionCreatedAt),
    aiOptIn: Boolean(aiOptInRow?.my_opt_in),
    partnerAiOptIn: Boolean(aiOptInRow?.partner_opt_in),
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
  wish: wishProcedures,
  mood: moodProcedures,
  aiSummary: aiSummaryProcedures,
});

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
import { wantProcedures } from "./procedures/want";
import { aiSummaryProcedures } from "./procedures/ai-summary";
import { albumProcedures, photoProcedures } from "./procedures/album";
import { billingProcedures } from "./procedures/billing";
import { adminProcedures } from "./procedures/admin";
import { holidayProcedures, weatherProcedures } from "./procedures/weather";
import { resolveUserImage } from "./lib/r2-signed-url";
import { isSessionFresh } from "./lib/reauth";

export type { RpcContext } from "./context";

const healthGet = implementer.health.get.handler(async ({ context }) => {
  // D1 への疎通確認。失敗すれば例外で 500
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

  // 未所属なら aiOptIn・partnerAiOptIn は両方 false。resolveCoupleContext を通さない
  // （未所属を NEEDS_ONBOARDING で弾くと me.get が失敗し、オンボーディング前の画面が壊れる）
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

  // image は Google の外部 URL か自分で上げた画像の R2 キー。後者だけ署名付き URL にする
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
  billing: billingProcedures,
  // 天気と祝日（読み取り。ゲストも通る）
  weather: weatherProcedures,
  holiday: holidayProcedures,
  // 運営（全部 adminProcedure）
  admin: adminProcedures,
  invite: inviteProcedures,
  post: { ...postProcedures, uploadUrl: postUploadUrl },
  reaction: reactionProcedures,
  event: eventProcedures,
  stats: statsProcedures,
  memory: memoryProcedures,
  wish: wishProcedures,
  want: wantProcedures,
  mood: moodProcedures,
  aiSummary: aiSummaryProcedures,
  album: albumProcedures,
  photo: photoProcedures,
});

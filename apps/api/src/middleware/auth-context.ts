import type { ORPCErrorConstructorMap } from "@orpc/server";
import type { RpcContext } from "../context";
import { isAdminEmail } from "../lib/admin-emails";

// couple_id の解決結果。全手続きはこれだけを使い、couple_id を自前で解決しない。
// mode で userId の有無が決まるユニオン型なので、readonly を弾いた後は userId が string に絞られる
export type CoupleContext =
  | { userId: string; coupleId: string; mode: "member" }
  | { userId: null; coupleId: string; mode: "readonly" };

type AuthErrors = ORPCErrorConstructorMap<{
  FORBIDDEN: Record<string, never>;
  NEEDS_ONBOARDING: Record<string, never>;
}>;

/**
 * 認可の要。couple_id の解決をここに集める（architecture.md 5節）。
 *
 * 1. 認証済み -> couple_members から couple_id を解決する。未所属なら NEEDS_ONBOARDING
 * 2. 未認証   -> couple_id = デモペアの id、mode = 'readonly'
 *    DEMO_COUPLE_ID が未設定・空文字なら FORBIDDEN（undefined のまま進むと条件が外れて全ペアが返りうる）
 *
 * 未認証は DEMO_COUPLE_ID を信じるだけでなく、`is_demo = 1` であることを DB で確かめてから通す
 * （env の書き間違い 1 つで実在のペアが公開される経路を塞ぐ。security-requirements.md 9節 T4）
 */
// 運営か。認証済みでメールが ADMIN_EMAILS に含まれるときだけ true（ゲストは false）。
// 判定はここの 1 箇所（adminProcedure と couple.get の isAdmin が呼ぶ。057）
export function resolveIsAdmin(context: RpcContext): boolean {
  if (!context.user) return false;
  return isAdminEmail(context.user.email, context.adminEmails ?? []);
}

export async function resolveCoupleContext(
  context: RpcContext,
  errors: AuthErrors,
): Promise<CoupleContext> {
  if (!context.user) {
    if (!context.demoCoupleId) throw errors.FORBIDDEN();
    const demo = await context.db
      .prepare("SELECT id FROM couples WHERE id = ?1 AND is_demo = 1")
      .bind(context.demoCoupleId)
      .first<{ id: string }>();
    if (!demo) throw errors.FORBIDDEN();
    return { userId: null, coupleId: demo.id, mode: "readonly" };
  }

  const row = await context.db
    .prepare("SELECT couple_id FROM couple_members WHERE user_id = ?1")
    .bind(context.user.id)
    .first<{ couple_id: string }>();
  if (!row) throw errors.NEEDS_ONBOARDING();

  return { userId: context.user.id, coupleId: row.couple_id, mode: "member" };
}

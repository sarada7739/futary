import type { ORPCErrorConstructorMap } from "@orpc/server";
import type { RpcContext } from "../context";

// couple_id の解決結果。以降の全手続きはこれだけを使い、couple_id を
// 自前で解決しない（docs/tasks/005-authorization-middleware.md）。
// mode で userId の有無が決まるユニオン型にして、writeProcedure が
// readonly を弾いた後は userId が string に絞り込まれるようにする
export type CoupleContext =
  | { userId: string; coupleId: string; mode: "member" }
  | { userId: null; coupleId: string; mode: "readonly" };

type AuthErrors = ORPCErrorConstructorMap<{
  FORBIDDEN: Record<string, never>;
  NEEDS_ONBOARDING: Record<string, never>;
}>;

/**
 * 認可の要。couple_id の解決をここに集約する（architecture.md 5節）。
 *
 * 1. 認証済み -> couple_members から couple_id を解決する。未所属なら NEEDS_ONBOARDING
 * 2. 未認証   -> couple_id = デモペアの id、mode = 'readonly'
 *    ただし DEMO_COUPLE_ID が未設定・空文字なら、その場で FORBIDDEN にする
 *    （014 でデモペアを作るまでの間、`undefined` を couple_id として先へ進めると
 *    条件が意図せず外れて全ペアのデータが返る形になり得るため。fail-closed）
 *
 * 未認証分岐は DEMO_COUPLE_ID の値を信用するだけでなく、実際に
 * `is_demo = 1` の couple であることを DB で確認してから通す
 * （T4: デモ経路からの本番データ漏洩。security-requirements.md 9節）。
 * env の設定ミス・書き間違い1つで実在ペアが未認証の全世界に公開される
 * 経路を、値の一致だけに頼らず塞ぐ（security-auditor 005監査 Medium指摘）
 */
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

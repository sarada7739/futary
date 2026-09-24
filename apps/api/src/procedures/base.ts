import type { Middleware, ORPCErrorConstructorMap } from "@orpc/server";
import { resolveCoupleContext, resolveIsAdmin, type CoupleContext } from "../middleware/auth-context";
import type { RpcContext } from "../context";

// このファイルの `any`（conventions.md 2節で通常は禁止）: 各基底は複数の手続きに使い回すので、
// Middleware の TOutput・TMeta を 1 つの型に固定できない。unknown だと `.use()` 側で型エラーになる。
// ミドルウェアは output・meta に触れないので実害は無い

// couple_id を要る手続きの契約は FORBIDDEN・NEEDS_ONBOARDING の両方を持つ必要がある（型で強制される）
type CoupleErrors = ORPCErrorConstructorMap<{
  FORBIDDEN: Record<string, never>;
  NEEDS_ONBOARDING: Record<string, never>;
}>;

type AuthedErrors = ORPCErrorConstructorMap<{ FORBIDDEN: Record<string, never> }>;

// 認証必須だけで couple_id を解決しない基底。未所属が前提の手続き（couple.create・invite.accept）用。
// 認可をこの基底の系統に揃え、.use() の書き忘れを型エラーにする
export const authedProcedure: Middleware<
  RpcContext,
  { user: NonNullable<RpcContext["user"]> },
  unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  AuthedErrors,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
> = async ({ context, next, errors }) => {
  if (!context.user) throw errors.FORBIDDEN();
  // handler 側で context.user を non-null として扱えるように、絞り込んだ値を積み直す
  return next({ context: { user: context.user } });
};

// 読み取り。未認証でも通り、デモペア（readonly）として扱う
export const readProcedure: Middleware<
  RpcContext,
  CoupleContext,
  unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  CoupleErrors,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
> = async ({ context, next, errors }) => next({ context: await resolveCoupleContext(context, errors) });

// 書き込み。readonly（未認証のデモ）は FORBIDDEN。OutContext を member に絞るので、
// 呼び出し側で userId が string になる
export const writeProcedure: Middleware<
  RpcContext,
  Extract<CoupleContext, { mode: "member" }>,
  unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  CoupleErrors,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
> = async ({ context, next, errors }) => {
  const coupleContext = await resolveCoupleContext(context, errors);
  if (coupleContext.mode === "readonly") throw errors.FORBIDDEN();
  return next({ context: coupleContext });
};

// 運営専用。認証済みで ADMIN_EMAILS に含まれなければ FORBIDDEN（ゲストも）。admin.* は全部これを使う（057）
export const adminProcedure: Middleware<
  RpcContext,
  { user: NonNullable<RpcContext["user"]> },
  unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  AuthedErrors,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
> = async ({ context, next, errors }) => {
  if (!context.user || !resolveIsAdmin(context)) throw errors.FORBIDDEN();
  return next({ context: { user: context.user } });
};

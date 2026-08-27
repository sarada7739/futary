import type { Middleware, ORPCErrorConstructorMap } from "@orpc/server";
import { resolveCoupleContext, type CoupleContext } from "../middleware/auth-context";
import type { RpcContext } from "../context";

// このファイルの `any` について（conventions.md 2節: 通常は禁止）。
// 各基底は複数の procedure に `.use()` で使い回す設計にしたため、
// `Middleware<...>` の TOutput（procedure ごとの戻り値の型）と
// TMeta（procedure ごとの oRPC メタ情報の型）を1つの変数の型として
// 固定できない。ここで具体的な型を書くと、使う procedure ごとに
// 異なるはずの型を無理やり単一の型に合わせることになり、実体と乖離する。
// ミドルウェア本体は output/meta のどちらにも触れないため、実害はない
// （Rレビュー005 往復1回目の指摘。unknown にすると `.use()` 側の代入で
// 型エラーになるため、ここでは unknown ではなく any を使っている）

// couple_id を必要とする手続きの contract は FORBIDDEN / NEEDS_ONBOARDING の
// 両方を持つ必要がある（そうでない手続きにこの基底は使えない。型で強制される）
type CoupleErrors = ORPCErrorConstructorMap<{
  FORBIDDEN: Record<string, never>;
  NEEDS_ONBOARDING: Record<string, never>;
}>;

type AuthedErrors = ORPCErrorConstructorMap<{ FORBIDDEN: Record<string, never> }>;

// 認証必須のみ・couple_id の解決はしない基底。couple.create / invite.accept
// のように「まだどのペアにも所属していない」ことが前提の手続き用
// （readProcedure/writeProcedure は未所属を NEEDS_ONBOARDING で弾くため使えない。
// security-auditor 005監査 Medium指摘: これが無いと認可が2系統に割れ、
// 将来 couple_id を使わない書き込み手続きで .use() を書き忘れても
// 型エラーにならず未認証で通ってしまう）
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

// 読み取り。`.use()` で個々の手続きに適用する。未認証でも通り、
// デモペア（readonly）として扱われる
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

// 書き込み。readonly（未認証のデモ）は FORBIDDEN
export const writeProcedure: Middleware<
  RpcContext,
  CoupleContext,
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

import { useSession } from "./auth-client";
import { useGuestMode } from "./guest-mode";

// ペアのデータ・利用者ごとのデータを読む問い合わせ（readProcedure の手続きと me.get）は coupleId・
// 対象ユーザーを引数に持たない（architecture.md 5節）ので、キャッシュのキーだけでは誰が呼んだか区別できない。
// ログイン⇄ゲスト⇄未認証を切り替えると直前の別人のキャッシュが一瞬出る（security-requirements.md T9）。
// effect の clear() では窓を閉じきれないので、キー自体に閲覧者の識別子を含める。
// これらの問い合わせを書くときは必ずこの値を queryKey に足す（viewer-key-coverage.test.ts が走査して強制する。
// readProcedure を使わない手続きは自動で見つからないので、同テストの MANUALLY_INCLUDED_PROCEDURES に足す）
export function useViewerQueryKey(): string {
  const { data: session } = useSession();
  const { isGuestMode } = useGuestMode();
  if (session?.user?.id) return `user:${session.user.id}`;
  if (isGuestMode) return "guest";
  return "anon";
}

// `_layout.tsx` は GuestModeContext の Provider より上で useGuestMode() が使えないので、手元の isDemoViewer を受け取る版
export function useViewerQueryKeyFrom(isDemoViewer: boolean): string {
  const { data: session } = useSession();
  if (session?.user?.id) return `user:${session.user.id}`;
  if (isDemoViewer) return "guest";
  return "anon";
}

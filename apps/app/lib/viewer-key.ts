import { useSession } from "./auth-client";
import { useGuestMode } from "./guest-mode";

// ペアのデータを読む問い合わせ（couple.get・stats.get・memory.get・
// post.list・event.list。いずれもapps/api/src/procedures/でreadProcedureを
// 使う手続き）は、coupleIdを引数に含まない（architecture.md 5節「引数に
// coupleIdを持つ手続きを作らない」設計のため）。このためTanStack Queryの
// キャッシュキーだけでは「誰が呼んだか」を区別できない。
//
// リロード無しで本物のログイン⇄ゲスト⇄未認証を切り替えると、直前の別人の
// キャッシュ（データまたはエラー）が一瞬そのまま画面に出る不具合が実機で
// 発生した（security-requirements.md T9）。`queryClient.clear()`を
// useEffectで呼ぶ対策はタイミングに依存し窓を閉じきれない（Rレビュー指摘・
// A決定）ため、構造的にキャッシュキー自体へ閲覧者の識別子を含める。
//
// ペアのデータを読む問い合わせを書くときは、必ずこの値をqueryKeyへ
// 追加すること（`apps/app/test/viewer-key-coverage.test.ts`が
// 呼び出し箇所を走査して強制する）。
export function useViewerQueryKey(): string {
  const { data: session } = useSession();
  const { isGuestMode } = useGuestMode();
  if (session?.user?.id) return `user:${session.user.id}`;
  if (isGuestMode) return "guest";
  return "anon";
}

// `_layout.tsx`はGuestModeContextのProviderより上にあり`useGuestMode()`が
// 使えないため、既に手元にある`isDemoViewer`を受け取る別版を用意する
export function useViewerQueryKeyFrom(isDemoViewer: boolean): string {
  const { data: session } = useSession();
  if (session?.user?.id) return `user:${session.user.id}`;
  if (isDemoViewer) return "guest";
  return "anon";
}

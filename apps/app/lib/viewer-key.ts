import { useSession } from "./auth-client";
import { useGuestMode } from "./guest-mode";

// ペアのデータ・利用者ごとのデータを読む問い合わせ（couple.get・
// stats.get・memory.get・post.list・event.list——いずれも
// apps/api/src/procedures/でreadProcedureを使う手続き。加えてme.get——
// readProcedureは使わないが認可基底を経由しない許可リスト
// 〈apps/api/test/authorization.test.tsのALLOWED_WITHOUT_BASE〉の例外で、
// 名前・メールアドレス・アイコン画像を返す）は、coupleId/対象ユーザーを
// 引数に含まない（architecture.md 5節「引数にcoupleIdを持つ手続きを
// 作らない」設計のため）。このためTanStack Queryのキャッシュキーだけでは
// 「誰が呼んだか」を区別できない。
//
// リロード無しで本物のログイン⇄ゲスト⇄未認証を切り替えると、直前の別人の
// キャッシュ（データまたはエラー）が一瞬そのまま画面に出る不具合が実機で
// 発生した（security-requirements.md T9）。`queryClient.clear()`を
// useEffectで呼ぶ対策はタイミングに依存し窓を閉じきれない（Rレビュー指摘・
// A決定）ため、構造的にキャッシュキー自体へ閲覧者の識別子を含める。
//
// 上記の問い合わせを書くときは、必ずこの値をqueryKeyへ追加すること
// （`apps/app/test/viewer-key-coverage.test.ts`が呼び出し箇所を走査して
// 強制する。ただしreadProcedureを使わない手続きは走査で自動検出できない
// ため、そちらは同テストの`MANUALLY_INCLUDED_PROCEDURES`に明示的に
// 追加すること——me.getが実際に抜けて気づけなかった。Rレビュー指摘）。
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

// 024（アカウント削除）専用の再認証チェック。sessionCreatedAt は
// 実際にサインインした時刻で、セッションの定期リフレッシュでは動かない
// （context.ts のコメント参照）。「新鮮」の基準は画面側の確認フロー
// （delete-account.tsx）とサーバ側の最終防御（me.ts の meDelete）で
// 共有する値のため、ここに1つだけ置く（Aの決定: 判定はサーバが真偽値で
// 返し、時刻をクライアントに比べさせない。event.tsのcanEditと同じ理由）
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

export function isSessionFresh(sessionCreatedAt: Date | null, now: Date = new Date()): boolean {
  if (!sessionCreatedAt) return false;
  return now.getTime() - sessionCreatedAt.getTime() <= REAUTH_WINDOW_MS;
}

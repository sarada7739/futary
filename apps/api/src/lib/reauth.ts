// アカウント削除の再認証。sessionCreatedAt は実際にサインインした時刻（リフレッシュでは動かない）。
// 「新鮮」の基準は画面とサーバ（me.delete）で共有するのでここ 1 つに置き、判定はサーバが真偽値で返す
// （時刻をクライアントに比べさせない。024）
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

// sessionCreatedAt はエポックミリ秒。Date.now() は暦・タイムゾーンを持たない数値なので eslint の対象外
// （architecture.md 5節）
export function isSessionFresh(sessionCreatedAt: number | null, now: number = Date.now()): boolean {
  if (sessionCreatedAt === null) return false;
  return now - sessionCreatedAt <= REAUTH_WINDOW_MS;
}

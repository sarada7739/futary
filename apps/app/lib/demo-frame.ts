// 056: LP のスマホの枠（iframe）の中でデモを動かすための 2 つ（Web だけ。ネイティブでは常に false）。
// - `/app/?demo=1` で開いたら、サインイン画面を経ずにゲストモードで始める（isGuestMode の初期値）。
//   認証済みなら _layout が isAuthenticated を優先するので無視される（0節 #2）。
//   サーバ側の拒否は変わらない（security-requirements.md 3節。このフラグは見せ方だけ）
// - 框の中（window.top !== window.self）ではサインイン画面を出せない（Google が iframe の中の OAuth を拒む）ので、
//   showAuth が立った瞬間に親ページを /app/ に飛ばす（0節 #3。入口は _layout の 1 箇所）
// - 框の中では API と認証の fetch に Cookie を送らない（credentials: "omit"）。ログイン中のブラウザで LP を開いても、
//   框の中はサーバから見て未認証 = 常にデモペアになり、実ユーザーのデータが框に写る経路が無い（人間の指示 2026-09-16）

export const DEMO_QUERY_KEY = "demo";
export const APP_PATH = "/app/";

export function isDemoEntry(search: string | undefined = typeof window === "undefined" ? undefined : window.location.search): boolean {
  if (!search) return false;
  return new URLSearchParams(search).get(DEMO_QUERY_KEY) === "1";
}

// テストで差し替えられるよう、top と self だけを持つ形で受ける
export type FrameWindow = { top: unknown; self: unknown };

export function isInFrame(win: FrameWindow | undefined = typeof window === "undefined" ? undefined : window): boolean {
  if (!win) return false;
  try {
    return win.top !== win.self;
  } catch {
    // クロスオリジンの親だと top に触れない = 框の中
    return true;
  }
}

// 親ページを /app/ へ。親に触れない（他サイトの框）ときは何もしない（'self' しか許していないので普通は来ない）
export function leaveFrameToApp(win: Window | undefined = typeof window === "undefined" ? undefined : window): void {
  if (!win) return;
  try {
    win.top?.location.assign(APP_PATH);
  } catch {
    // 触れなければ諦める
  }
}

// 框の中では Cookie を送らない（同じオリジンでも "omit" は Cookie を付けない。Fetch の仕様）。
// 呼び出しごとに評価する（orpc.ts・auth-client.ts の fetch から呼ぶ）
export function frameCredentials(): RequestCredentials {
  return isInFrame() ? "omit" : "include";
}

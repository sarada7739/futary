// LP のスマホの枠（iframe）の中でデモを動かすためのもの（Web だけ。ネイティブでは常に false。056）。
// - `/app/?demo=1` で開いたら、サインイン画面を経ずにゲストで始める（認証済みなら _layout が優先する）。
//   サーバの拒否は変わらない（このフラグは見せ方だけ）
// - 枠の中ではサインイン画面を出せない（Google が iframe の中の OAuth を拒む）ので、showAuth が立った瞬間に
//   親ページを /app/ に飛ばす（入口は _layout の 1 箇所）
// - 枠の中では API と認証の fetch に Cookie を送らない（credentials: "omit"）。ログイン中のブラウザで LP を
//   開いても、枠の中はサーバから見て未認証 = 常にデモペアになり、実ユーザーのデータが枠に写らない

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
    // クロスオリジンの親だと top に触れない = 枠の中
    return true;
  }
}

// 親ページを /app/ へ。親に触れない（他サイトの枠）ときは何もしない（frame-ancestors 'self' なので普通は来ない）
export function leaveFrameToApp(win: Window | undefined = typeof window === "undefined" ? undefined : window): void {
  if (!win) return;
  try {
    win.top?.location.assign(APP_PATH);
  } catch {
    // 触れなければ諦める
  }
}

// 枠の中では Cookie を送らない（同じオリジンでも "omit" は付けない）。呼び出しごとに評価する（orpc.ts・auth-client.ts）
export function frameCredentials(): RequestCredentials {
  return isInFrame() ? "omit" : "include";
}

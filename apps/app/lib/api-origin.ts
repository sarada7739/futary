// 本番はアプリと API が同一オリジン。ローカルは別ポートなので EXPO_PUBLIC_API_ORIGIN で指定する（.env.example）。
//
// 関数にしてある: モジュール直下の定数式だと、`expo export --platform web` の最適化が
// `typeof window !== "undefined"` を固定値に畳み込み、ブラウザ向けのバンドルに localhost が焼き込まれる（015）。
// 静的書き出し（SSG）は Node で描くので window が本当に無い。ここで投げると SSG が失敗するので、フォールバックを
// 返してよい（実際の API 呼び出しは hydrate 後のブラウザで、window の分岐に入る）
export function getApiOrigin(): string {
  if (process.env.EXPO_PUBLIC_API_ORIGIN) return process.env.EXPO_PUBLIC_API_ORIGIN;
  if (typeof window !== "undefined" && window.location) return window.location.origin;
  return "http://localhost:8787";
}

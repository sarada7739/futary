// 本番はアプリとAPIを同一Workerから配信するため同一オリジンになる。
// ローカル開発は apps/app (Expo) と apps/api (wrangler dev) が別ポートで動くため、
// EXPO_PUBLIC_API_ORIGIN で明示的に指定する（.env.example 参照）。
//
// 関数にしてある理由（015で実測）: モジュール直下の定数式にすると、
// `expo export --platform web`（output: "static"）のビルド時最適化が
// `typeof window !== "undefined"` をビルド時に固定値へ畳み込み、
// ブラウザ向けバンドルにまで「http://localhost:8787」が焼き込まれてしまう
// （実際のブラウザで実行される段になってもwindowの有無を再判定しない）。
// 呼び出し時に評価する関数にすることで、実行時（ブラウザでの初回呼び出し時）に
// 判定させる
export function getApiOrigin(): string {
  if (process.env.EXPO_PUBLIC_API_ORIGIN) return process.env.EXPO_PUBLIC_API_ORIGIN;
  if (typeof window !== "undefined" && window.location) return window.location.origin;
  return "http://localhost:8787";
}

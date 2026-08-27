// 本番はアプリとAPIを同一Workerから配信するため同一オリジンになる。
// ローカル開発は apps/app (Expo) と apps/api (wrangler dev) が別ポートで動くため、
// EXPO_PUBLIC_API_ORIGIN で明示的に指定する（.env.example 参照）
export const apiOrigin =
  process.env.EXPO_PUBLIC_API_ORIGIN ??
  (typeof window !== "undefined" && window.location
    ? window.location.origin
    : "http://localhost:8787");

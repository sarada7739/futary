// テストのフィクスチャを Vite の `?raw` で文字列として読み込むための型（040 T2）
declare module "*?raw" {
  const content: string;
  export default content;
}

// 054 T4: apps/landing/assets/ のファイル名と大きさ（apps/api/vitest.config.ts の仮想モジュール）
declare module "virtual:landing-assets" {
  const files: ReadonlyArray<{ name: string; bytes: number }>;
  export default files;
}

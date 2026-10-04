// テストのフィクスチャを Vite の `?raw` で文字列として読み込むための型（040 T2）
declare module "*?raw" {
  const content: string;
  export default content;
}

// 054 T4: apps/landing/assets/ のファイル名と大きさ（apps/api/vitest.config.ts の仮想モジュール）
declare module "virtual:landing-assets" {
  const files: ReadonlyArray<{
    name: string;
    bytes: number;
    // PNG（RGBA 8bit）だけ。056 T6: 指定した点のアルファ（center・leftBezel・topLeftOutside・notch・screenBottom）
    png?: { width: number; height: number; alphaAt: Record<string, number> };
  }>;
  export default files;
  // 056 T5: apps/landing/style.css の本文
  export const styleCss: string;
}

// 068 T3: scripts/build-public.mjs の bundlePhone3d() の結果（設定側の Node で束ねる。テストは workerd で esbuild が無い）
declare module "virtual:phone3d-bundle" {
  export const bytes: number;
  export const gzipBytes: number;
  export const gzipLimit: number;
  // 本文に現れる http(s):// の URL（重複なし）
  export const urls: readonly string[];
  export const hasDynamicImport: boolean;
}

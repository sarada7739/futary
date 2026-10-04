// build-public.mjs の export の型（テストが import する分だけ。本体は JS のまま）
export function stripHtmlComments(text: string): string;
export function stripCssComments(text: string): string;
export const PHONE3D_GZIP_LIMIT: number;
export function bundlePhone3d(): { code: string; gzipBytes: number };

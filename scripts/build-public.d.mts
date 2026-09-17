// 060: build-public.mjs の export の型（apps/api/test/build-public.test.ts が import する分だけ）。
// 本体は JS のまま。同名の .d.mts を隣に置くと tsc が拾う
export function stripHtmlComments(text: string): string;
export function stripCssComments(text: string): string;

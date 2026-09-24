// 本番の正しいホストは nisoine.com。旧 URL（*.workers.dev）と www はここへ 301 で寄せる（053）。
// 環境変数にしない（ホストは 1 つで、ローカルは localhost なので isLegacyHost が false になり何もしない）。
// BETTER_AUTH_URL とは役割が違う（あちらは Better Auth の baseURL で、ローカルは localhost）
export const CANONICAL_HOST = "nisoine.com";
export const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;

// 旧ホスト: Cloudflare の共有ドメインと www。*.workers.dev を末尾一致で見るので、Worker 名やサブドメインが
// 変わっても、プレビュー URL でも同じ扱い
export function isLegacyHost(hostname: string): boolean {
  return hostname === `www.${CANONICAL_HOST}` || hostname.endsWith(".workers.dev");
}

// 同じパス・同じクエリで正しいオリジンへ（# はサーバに届かない）
export function canonicalUrlFor(url: URL): string {
  return `${CANONICAL_ORIGIN}${url.pathname}${url.search}`;
}

// 旧ホストへの API 呼び出し（古いタブ）に返す本文。301 だと fetch が黙って追い、Cookie が無くて 401 に
// なるだけで何が起きたか分からないので、403 と文言で「開き直して」と伝える
export const LEGACY_ORIGIN_MESSAGE = `${CANONICAL_HOST} で開き直してください`;

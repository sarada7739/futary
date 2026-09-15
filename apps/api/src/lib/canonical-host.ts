// 053: 本番の正しいホストは nisoine.com。旧 URL（*.workers.dev）と www は
// ここへ 301 で寄せる（docs/tasks/053-custom-domain.md 0節 #2）。
//
// 環境変数にしない: 正しいホストは 1 つで、ローカルと本番で変わらない
// （ローカルは localhost なので isLegacyHost が false になり、何もしない）。
// BETTER_AUTH_URL と二重に持つ形になるが、あちらは Better Auth の baseURL
// （secret。ローカルは http://localhost:8787）で役割が違う
export const CANONICAL_HOST = "nisoine.com";
export const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;

// 旧ホスト: Cloudflare の共有ドメイン（futary-api.sarada7739.workers.dev）と www。
// *.workers.dev を末尾一致で見るのは、Worker 名やアカウントのサブドメインが
// 変わっても「共有ドメインで届いたら正しいホストへ」が変わらないため。
// プレビュー URL（<version>-futary-api.sarada7739.workers.dev）も同じ扱いになる
export function isLegacyHost(hostname: string): boolean {
  return hostname === `www.${CANONICAL_HOST}` || hostname.endsWith(".workers.dev");
}

// 同じパス・同じクエリで正しいオリジンへ（T1「クエリも保つ」）。
// ハッシュ（#）はサーバに届かないので考えない
export function canonicalUrlFor(url: URL): string {
  return `${CANONICAL_ORIGIN}${url.pathname}${url.search}`;
}

// 旧ホストへの API 呼び出し（開きっぱなしの古いタブ）に返す本文。
// 301 にしない: XHR/fetch は 301 を黙って追い、Cookie は新オリジンに無いので
// 結局 401 になり、利用者には何が起きたか分からない。403 と文言で「開き直して」と伝える
export const LEGACY_ORIGIN_MESSAGE = `${CANONICAL_HOST} で開き直してください`;

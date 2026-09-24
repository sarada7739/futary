// セキュリティヘッダは Worker が付ける（run_worker_first では `_headers` が Worker の応答に効かない）。
//
// CSP の script-src のハッシュ: apps/app の inline script（2 本）は本文がビルドごとに変わりうるので、
// 配信する HTML を読んで sha256 を計算する（ビルド時のファイルを持ち込むと、変わったとき黙って古くなる）。
// 「inline script は 2 本・全ページ同じ」の留め金は build-public.mjs にある。
//
// img-src/connect-src の R2 ホストは env.R2_ACCOUNT_ID の単一ホストに絞る
// （`*.r2.cloudflarestorage.com` だと XSS のときの持ち出し先に攻撃者のバケットまで含む）。
// 未設定なら足さない（画像は出なくなるが、許可先が広がる側には倒れない）

// 全応答（API・301・静的アセット）に付ける固定のヘッダ。
// - HSTS: 独自ドメインは *.workers.dev と違い preload されていないので自分で付ける（SSL ストリップ対策）
// - nosniff・Referrer-Policy: API の JSON にも意味がある
export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export function applyStaticSecurityHeaders(res: Response): void {
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    res.headers.set(name, value);
  }
}

// - R2 の署名付き URL（画像の取得・アップロード）は https://<r2host> のみ
// - blob: は画像投稿に要る（expo-image-picker・expo-image-manipulator の Web 実装が URL.createObjectURL() を使う）
// - lh3.googleusercontent.com は Google のプロフィール画像（resolveUserImage）
// - frame-ancestors 'self' はクリックジャッキング対策（meta タグでは効かない）。LP（同じオリジン）が
//   /app/?demo=1 を iframe で埋めるので 'self'。他サイトからは拒む（056）
// - form-action は default-src にフォールバックしない独立ディレクティブ
export function buildCsp(inlineScriptHashes: readonly string[], r2AccountId: string | undefined): string {
  const r2Host = r2AccountId ? ` https://${r2AccountId}.r2.cloudflarestorage.com` : "";
  const hashes = inlineScriptHashes.map((h) => ` '${h}'`).join("");
  return (
    "default-src 'self'; " +
    `script-src 'self'${hashes}; ` +
    "style-src 'self' 'unsafe-inline'; " +
    `img-src 'self' data: blob:${r2Host} https://lh3.googleusercontent.com; ` +
    "font-src 'self'; " +
    `connect-src 'self' blob:${r2Host}; ` +
    "frame-ancestors 'self'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
}

// src 属性の無い <script> の本文を取り出す。build-public.mjs と同じ正規表現
// （属性の並びに依存しない・本文に `<` があっても `</script>` まで読む）
const SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

export function extractInlineScripts(html: string): string[] {
  const scripts: string[] = [];
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    if (/\bsrc\s*=/.test(match[1] ?? "")) continue;
    scripts.push(match[2] ?? "");
  }
  return scripts;
}

export async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function inlineScriptHashes(html: string): Promise<string[]> {
  const scripts = [...new Set(extractInlineScripts(html))];
  return Promise.all(scripts.map(async (s) => `sha256-${await sha256Base64(s)}`));
}

function isHtml(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
}

// ハッシュはパス + ETag で 1 度だけ計算してメモリに持つ（リクエストごとに HTML を読み直さない）。
// ETag はファイルの内容から決まるので、デプロイで HTML が変わればキーも変わる。上限は保険
const HASH_CACHE_LIMIT = 256;
const hashCache = new Map<string, string[]>();

async function cachedInlineScriptHashes(res: Response, pathname: string): Promise<{ hashes: string[]; body: BodyInit | null }> {
  const etag = res.headers.get("etag");
  const key = etag ? `${pathname}|${etag}` : null;
  const hit = key ? hashCache.get(key) : undefined;
  if (hit) return { hashes: hit, body: res.body };
  const html = await res.text();
  const hashes = await inlineScriptHashes(html);
  if (key) {
    if (hashCache.size >= HASH_CACHE_LIMIT) hashCache.clear();
    hashCache.set(key, hashes);
  }
  return { hashes, body: html };
}

// テスト用（キャッシュの効きを確かめる）
export function inlineScriptHashCacheSize(): number {
  return hashCache.size;
}

// ASSETS binding の応答はヘッダが immutable なので複製して CSP を付ける（固定ヘッダもこの複製に付く）。
// HTML 以外（JS・画像・CSS）には付けない（意味を持たない）
export async function withContentSecurityPolicy(
  res: Response,
  pathname: string,
  r2AccountId: string | undefined,
): Promise<Response> {
  if (!isHtml(res) || res.status !== 200) {
    return new Response(res.body, res);
  }
  const { hashes, body } = await cachedInlineScriptHashes(res, pathname);
  const out = new Response(body, res);
  out.headers.set("Content-Security-Policy", buildCsp(hashes, r2AccountId));
  return out;
}

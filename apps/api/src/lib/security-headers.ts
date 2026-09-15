// 053: セキュリティヘッダは Worker が付ける。
//
// それまでは scripts/build-public.mjs が `_headers` に書き、Cloudflare の静的アセット
// 配信が付けていた。053 で旧ホスト（*.workers.dev・www）の 301 を Worker の先頭で
// 行うために run_worker_first = true にしたところ、「`_headers` は Worker が生成した
// 応答には適用されない」（Cloudflare の文書。SSR や run_worker_first の場合は
// Worker で付けよ、とある）ため、ここへ移した。
//
// CSP の script-src のハッシュ: apps/app の Expo Web エクスポートは inline script を
// 2 本持つ（Expo Router の hydrate フラグ・+html.tsx の外観の先読み）。本文は
// ビルドごとに変わりうるので、決め打ちにせず **配信する HTML を読んで sha256 を
// 計算**する。ビルド時に生成したファイルを持ち込む形にしないのは、ハッシュが
// 変わったときに黙って古くなる経路を作らないため。「inline script は 2 本・全ページ
// 同じ」という留め金は build-public.mjs に残っている（Worker は来た HTML の
// inline script を全部許すので、想定外の inline script を止めるのはビルドの役目）。
//
// img-src/connect-src の R2 ホストは env.R2_ACCOUNT_ID（署名付き URL と同じ
// アカウント。単一ホストに絞る理由は build-public.mjs の旧コメントと同じ:
// `*.r2.cloudflarestorage.com` で許すと XSS 成立時の持ち出し先に攻撃者自身の
// バケットまで含む）。未設定なら R2 のホストを **足さない**（fail-closed。
// 画像は出なくなるが、許可先が広がる方向には倒れない）

// 全応答（API・301・静的アセット）に付ける固定のヘッダ。
// - HSTS: 独自ドメインは *.workers.dev と違い preload されていないので自分で付ける
//   （053 タスク定義 0節 #5。SSL ストリップ対策）
// - nosniff・Referrer-Policy: `_headers` にあったものと同じ。API の JSON にも意味がある
//   （security-auditor 全体監査 Low-3）
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

// `_headers` にあった CSP と同じ内容（内訳の理由は build-public.mjs の 015 当時の
// コメントから移した）:
// - R2 の署名付き URL（画像の取得・アップロード）は https://<r2host> のみ
// - blob: は画像投稿パイプラインに必須（expo-image-picker / expo-image-manipulator の
//   Web 実装が URL.createObjectURL() を使う）
// - lh3.googleusercontent.com は Google OAuth のプロフィール画像（resolveUserImage）
// - frame-ancestors 'none' はクリックジャッキング対策（meta タグでは効かない）
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
    "frame-ancestors 'none'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
}

// src 属性の無い <script> の本文を取り出す。build-public.mjs の extractInlineScriptHash と
// 同じ正規表現（属性の並びに依存しない・本文に `<` があっても `</script>` まで読む）
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

// ハッシュはアセットのパス + ETag で 1 度だけ計算し、モジュールのメモリに持つ
// （A の条件。リクエストごとに HTML を読み直さない）。ETag は配信するファイルの
// 内容から決まるので、デプロイで HTML が変わればキーが変わる。isolate が入れ替われば
// 空から始まる（それでよい。ページ数は有限なので上限は保険）
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

// 静的アセットの応答に CSP を付けて返す。ASSETS binding の応答はヘッダが immutable
// なので、複製して返す（呼び出し側の固定ヘッダの付与もこの複製に対して行われる）。
// HTML 以外（JS・画像・CSS）には CSP を付けない（意味を持たない。A の条件 T4c）
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

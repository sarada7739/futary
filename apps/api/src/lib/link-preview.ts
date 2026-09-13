// 040: 利用者が書いた URL のページを Worker が fetch して、題名と画像を取る。
// futary で「利用者の URL をサーバが fetch する」口はここ1本だけ
// （security-requirements.md 6節「外部 URL の取得」。発火は want.create のときだけ）。
// 6節の条件はすべてこのファイルの中で満たす。呼ぶ側（procedures/want.ts）は
// fetchLinkPreview を呼ぶだけで、条件を知らない。
//
// 数値の根拠は段階0の実測（artifacts/040/spike.md・タスク定義「段階0の決定」）:
// - ページは先頭 1MB（Amazon の画像属性は 325〜612KB の位置にあり、512KB では 28/30）
// - 全体で 12 秒（楽天は Cloudflare からの fetch を約 10 秒待たせる）
// - Amazon は OGP を出さない。`<meta name="title">` と `data-old-hires` から取る

export const LINK_PREVIEW_USER_AGENT = "futary-link-preview/1 (+https://futary-api.sarada7739.workers.dev)";
export const MAX_REDIRECTS = 3;
export const PAGE_BYTE_LIMIT = 1024 * 1024;
export const TOTAL_TIMEOUT_MS = 12_000;
export const IMAGE_BYTE_LIMIT = 1024 * 1024;
// 失敗理由をログに残す長さ（AI まとめの修正 #280 と同じ形）
const FAILURE_BODY_HEAD = 200;

// 保存する画像の型と、R2 のキーの拡張子。これ以外は保存しない
export const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export type LinkImageContentType = keyof typeof ALLOWED_IMAGE_TYPES;
export type LinkImageExtension = (typeof ALLOWED_IMAGE_TYPES)[LinkImageContentType];

export interface LinkImage {
  bytes: Uint8Array;
  contentType: LinkImageContentType;
  extension: LinkImageExtension;
}

export interface LinkPreview {
  title: string | null;
  image: LinkImage | null;
  // 取れなかった理由（status・本文の先頭 200 文字）。ログにだけ出す。クライアントには返さない
  failures: string[];
}

// テストで fetch を差し替えるための注入口。既定は globalThis.fetch
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// --- ホストの検査 ---------------------------------------------------------------

// IPv4 リテラル（"192.168.0.1" / "127.1" のような短縮形も URL パーサが正規化して
// 数字とドットだけになる）と IPv6 リテラル（URL.hostname は "[::1]" の形で返す）
function isIpLiteral(hostname: string): boolean {
  if (hostname.startsWith("[")) return true;
  return /^\d+(\.\d+){0,3}$/.test(hostname);
}

// 6節: ホストが IP リテラル・localhost・.local・.internal なら取りに行かない。
// Cloudflare 側でも塞がれているが、二重にする。リダイレクトの行き先も同じ検査を通す
export function isFetchableHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (isIpLiteral(host)) return false;
  return true;
}

// 6節: http / https 以外は取りに行かない（契約の入力スキーマでも弾いている。二重）
export function isFetchableUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return isFetchableHost(url.hostname);
}

// --- HTML から拾う ---------------------------------------------------------------

// 属性値に入る HTML 実体だけを戻す（`og:image` の URL に `&amp;` が入る）
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `<meta property="og:title" content="…">` と、content が先に来る書き方の両方を拾う。
// 6節「取った HTML から拾うのは、決まった属性値だけ。DOM を組み立てない」。
// 属性値に `<` `>` を許さない（閉じ引用符の無い壊れた属性が、次のタグまで丸ごと値になるのを防ぐ）。
// 引用符は開いた種類と同じもので閉じる（R の必須修正1: `content="Levi's 501"` の `'` を閉じ引用符と
// 見なして `Levi` で切れていた。`Levi's`・`Kids'` は商品名に普通にある）
const QUOTED_VALUE = `(?:"([^"<>]*)"|'([^'<>]*)')`;

function quotedValueOf(match: RegExpMatchArray, firstGroup: number): string {
  return match[firstGroup] ?? match[firstGroup + 1] ?? "";
}

function pickMeta(html: string, attr: "property" | "name", key: string): string | null {
  const k = escapeRegExp(key);
  const first = new RegExp(`<meta\\b[^>]*\\b${attr}\\s*=\\s*["']${k}["'][^>]*\\bcontent\\s*=\\s*${QUOTED_VALUE}`, "i");
  const second = new RegExp(`<meta\\b[^>]*\\bcontent\\s*=\\s*${QUOTED_VALUE}[^>]*\\b${attr}\\s*=\\s*["']${k}["']`, "i");
  const match = html.match(first) ?? html.match(second);
  if (!match) return null;
  const value = decodeEntities(quotedValueOf(match, 1)).trim();
  return value === "" ? null : value;
}

// Amazon のホストに限って動かす店ごとの規則（6節「拾うもの」に列挙してある。
// 他の店の HTML に偶然同じ属性があっても拾わない: 効く範囲を狭くしておけば、
// 壊れたときの範囲も狭い。タスク定義「段階0の決定」）
export function isAmazonHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "amazon.co.jp" || host === "www.amazon.co.jp" || host === "amazon.com" || host === "www.amazon.com";
}

// `<img id="landingImage" data-old-hires="…" data-a-dynamic-image="{…}">`。
// data-old-hires が無ければ data-a-dynamic-image（JSON を &quot; で書いた属性）の先頭のキー
function pickAmazonImage(html: string): string | null {
  const hires = html.match(new RegExp(`\\bdata-old-hires\\s*=\\s*${QUOTED_VALUE}`, "i"));
  if (hires) {
    const value = decodeEntities(quotedValueOf(hires, 1));
    if (value !== "") return value;
  }
  const dynamic = html.match(new RegExp(`\\bdata-a-dynamic-image\\s*=\\s*${QUOTED_VALUE}`, "i"));
  if (dynamic) {
    const firstKey = decodeEntities(quotedValueOf(dynamic, 1)).match(/"(https?:[^"]+)"/);
    if (firstKey?.[1]) return firstKey[1];
  }
  return null;
}

export interface ExtractedMeta {
  title: string | null;
  imageUrl: string | null;
}

// 順は OGP → twitter:image → `<meta name="title">`。Amazon に限り data-old-hires
// （タスク定義「段階0の決定」1）。純粋関数。テストは段階0で取った本物の HTML を渡す
export function extractMeta(html: string, pageHostname: string): ExtractedMeta {
  const title = pickMeta(html, "property", "og:title") ?? pickMeta(html, "name", "title");
  let imageUrl = pickMeta(html, "property", "og:image") ?? pickMeta(html, "name", "twitter:image");
  if (!imageUrl && isAmazonHost(pageHostname)) imageUrl = pickAmazonImage(html);
  return { title, imageUrl };
}

// --- 題名の整形 ---------------------------------------------------------------

// Amazon に限り、前置き「Amazon | 」「Amazon.co.jp: 」と末尾の「 | … 通販」を落とす。
// その上で全店共通に 100 文字で切る（タスク定義「段階0の決定」5。題名は入力欄の
// 初期値で、利用者が直せる）。文字数はコードポイントで数える（サロゲートペアを割らない）
export function normalizeTitle(raw: string, pageHostname: string, maxLength: number): string | null {
  let title = raw.replace(/\s+/g, " ").trim();
  if (isAmazonHost(pageHostname)) {
    title = title.replace(/^Amazon(?:\.co\.jp|\.com)?\s*(?:\||:|｜)\s*/i, "");
    title = title.replace(/\s*(?:\||｜)\s*[^|｜]*通販\s*$/, "");
    title = title.trim();
  }
  const chars = Array.from(title);
  if (chars.length > maxLength) title = chars.slice(0, maxLength).join("");
  return title === "" ? null : title;
}

// --- 応答を読む ---------------------------------------------------------------

// 先頭 limit バイトまで読んで打ち切る。読み切ったら残りは捨てる（reader.cancel）
async function readUpTo(response: Response, limit: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const body = response.body;
  if (!body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total > limit) truncated = true;
  else {
    // ちょうど limit で止まった場合、続きがあるかを1回だけ確かめる
    const { done } = total >= limit ? await reader.read() : { done: true };
    if (!done) truncated = true;
  }
  await reader.cancel().catch(() => {});
  const size = Math.min(total, limit);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    const n = Math.min(chunk.byteLength, size - offset);
    if (n <= 0) break;
    out.set(chunk.subarray(0, n), offset);
    offset += n;
  }
  return { bytes: out, truncated };
}

// 6節: 文字コードは応答の Content-Type の charset で TextDecoder を選ぶ。無い・未知なら UTF-8
// （楽天は EUC-JP。段階0で Workers の TextDecoder("EUC-JP") が動くことを確認済み）
export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const charset = /charset\s*=\s*"?([\w.-]+)/i.exec(contentType ?? "")?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset, { fatal: false }).decode(bytes);
    } catch {
      // 未知の charset → UTF-8
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function mediaTypeOf(contentType: string | null): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

// 6節: 応答の Content-Type と先頭バイトの両方を見る
export function sniffImageType(bytes: Uint8Array): LinkImageContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

async function bodyHead(response: Response): Promise<string> {
  try {
    const { bytes } = await readUpTo(response, 1024);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\s+/g, " ").trim().slice(0, FAILURE_BODY_HEAD);
  } catch {
    return "(本文を読めませんでした)";
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface Fetched {
  response: Response;
  finalUrl: string;
}

// 6節: リダイレクトは 3 回まで。行き先の URL も同じ検査を通す（redirect: "manual" で
// 1 段ずつ自分で辿る。fetch に任せると行き先の検査ができない）。
// Cookie・認証ヘッダを送らない（Workers の fetch は既定で Cookie を持たない。
// ヘッダはここで並べたものだけ）。User-Agent は futary を名乗る
async function fetchFollowingRedirects(
  fetchImpl: FetchLike,
  startUrl: string,
  accept: string,
  signal: AbortSignal,
  failures: string[],
): Promise<Fetched | null> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isFetchableUrl(current)) {
      failures.push(hop === 0 ? "取りに行けない URL" : "リダイレクト先が取りに行けない URL");
      return null;
    }
    const response = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        "user-agent": LINK_PREVIEW_USER_AGENT,
        accept,
        "accept-language": "ja,en;q=0.8",
      },
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) {
        failures.push(`${response.status} に location が無い`);
        return null;
      }
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        failures.push("リダイレクト先の URL が壊れている");
        return null;
      }
      current = next;
      continue;
    }
    return { response, finalUrl: current };
  }
  failures.push(`リダイレクトが ${MAX_REDIRECTS} 回を超えた`);
  return null;
}

async function fetchImage(
  fetchImpl: FetchLike,
  imageUrl: string,
  signal: AbortSignal,
  failures: string[],
): Promise<LinkImage | null> {
  const fetched = await fetchFollowingRedirects(fetchImpl, imageUrl, "image/jpeg,image/png,image/webp,image/*;q=0.8", signal, failures);
  if (!fetched) return null;
  const { response } = fetched;
  if (!response.ok) {
    failures.push(`画像 ${response.status}: ${await bodyHead(response)}`);
    return null;
  }
  const declared = mediaTypeOf(response.headers.get("content-type"));
  // `in` だと `constructor` 等のプロトタイプ名が通る（先頭バイトで必ず落ちるが、意図が読める方に。R の記録2）
  if (!Object.hasOwn(ALLOWED_IMAGE_TYPES, declared)) {
    await response.body?.cancel().catch(() => {});
    failures.push(`画像の Content-Type が許可外: ${declared || "(無し)"}`);
    return null;
  }
  const { bytes, truncated } = await readUpTo(response, IMAGE_BYTE_LIMIT);
  if (truncated) {
    failures.push(`画像が ${IMAGE_BYTE_LIMIT} バイトを超えた`);
    return null;
  }
  const sniffed = sniffImageType(bytes);
  if (sniffed === null || sniffed !== declared) {
    failures.push(`画像の先頭バイトが Content-Type（${declared}）と合わない`);
    return null;
  }
  return { bytes, contentType: sniffed, extension: ALLOWED_IMAGE_TYPES[sniffed] };
}

export interface FetchLinkPreviewOptions {
  fetchImpl?: FetchLike;
  maxTitleLength: number;
  // 手で付けた画像が既にあるときは題名だけ取り、画像は取りに行かない（既定 true）
  needImage?: boolean;
}

// 実際に外へ fetch する唯一の関数。失敗は例外にしない（呼ぶ側の保存を失敗させない。
// 6節「失敗しても手続きは成功する」）。理由は failures に積んで返す
export async function fetchLinkPreview(url: string, options: FetchLinkPreviewOptions): Promise<LinkPreview> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const failures: string[] = [];
  // 6節: 全体で 12 秒。ページと画像を合わせて1つの期限で打ち切る
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  try {
    const fetched = await fetchFollowingRedirects(
      fetchImpl,
      url,
      "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      controller.signal,
      failures,
    );
    if (!fetched) return { title: null, image: null, failures };
    const { response, finalUrl } = fetched;
    if (!response.ok) {
      failures.push(`ページ ${response.status}: ${await bodyHead(response)}`);
      return { title: null, image: null, failures };
    }
    // 店ごとの規則（Amazon）は、元の URL ではなく実際に読んだページ（リダイレクト後）のホストで
    // 判定する（R の必須修正2: Amazon アプリの共有は amzn.asia の短縮 URL で、元の URL のホストで
    // 判定すると人間の主な使い方で画像が付かない。効く範囲は「読んだページが Amazon」のまま狭い）
    const pageHostname = new URL(finalUrl).hostname;
    // 6節: ページは先頭 1MB で打ち切る
    const { bytes } = await readUpTo(response, PAGE_BYTE_LIMIT);
    const html = decodeHtml(bytes, response.headers.get("content-type"));
    const meta = extractMeta(html, pageHostname);
    const title = meta.title ? normalizeTitle(meta.title, pageHostname, options.maxTitleLength) : null;

    let image: LinkImage | null = null;
    if (options.needImage === false) {
      // 画像は要らない（呼ぶ側が既に持っている）
    } else if (meta.imageUrl) {
      let resolved: string | null = null;
      try {
        resolved = new URL(meta.imageUrl, finalUrl).toString();
      } catch {
        failures.push("画像の URL が壊れている");
      }
      if (resolved) image = await fetchImage(fetchImpl, resolved, controller.signal, failures);
    } else {
      failures.push("画像の属性が無い");
    }
    return { title, image, failures };
  } catch (error) {
    // 中断（12 秒超）・ネットワーク断・デコード失敗。URL や本文は含めない
    const name = error instanceof Error ? error.name : "Error";
    failures.push(name === "AbortError" ? `${TOTAL_TIMEOUT_MS}ms で打ち切った` : `fetch に失敗した（${name}）`);
    return { title: null, image: null, failures };
  } finally {
    clearTimeout(timer);
  }
}

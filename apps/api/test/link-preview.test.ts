import { describe, expect, it, vi } from "vitest";
import {
  decodeHtml,
  extractMeta,
  fetchLinkPreview,
  IMAGE_BYTE_LIMIT,
  isFetchableUrl,
  LINK_PREVIEW_USER_AGENT,
  MAX_REDIRECTS,
  normalizeTitle,
  PAGE_BYTE_LIMIT,
  sniffImageType,
  TOTAL_TIMEOUT_MS,
  type FetchLike,
} from "../src/lib/link-preview";
// 段階0で Cloudflare 側から実際に取った HTML（fixtures/link-preview/README.md）
import amazonHtml from "./fixtures/link-preview/amazon-B0HJBHHXK2.html?raw";
import amazonHead512k from "./fixtures/link-preview/amazon-B07T35N29H-head512k.html?raw";
import uniqloHtml from "./fixtures/link-preview/uniqlo-E422992.html?raw";
import rakutenBase64 from "./fixtures/link-preview/rakuten-jp8670.euc-jp.html.base64?raw";
import mujiBody from "./fixtures/link-preview/muji-520.txt?raw";

const AMAZON_HOST = "www.amazon.co.jp";
const MAX_TITLE = 100;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const rakutenBytes = base64ToBytes(rakutenBase64);

// 先頭バイトが本物の JPEG / PNG / WebP に見えるダミー
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function bytesOf(head: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(head.subarray(0, Math.min(head.length, size)));
  return out;
}

interface Route {
  status?: number;
  headers?: Record<string, string>;
  // Uint8Array は Response に渡す前に ArrayBuffer へ写す（型の都合。下の fakeFetch）
  body?: BodyInit | Uint8Array | null;
}

function toBody(body: BodyInit | Uint8Array | null | undefined): BodyInit | null {
  if (body === undefined || body === null) return null;
  if (body instanceof Uint8Array) return body.slice().buffer;
  return body;
}

// URL ごとに応答を返す fetch。呼ばれた URL と init を記録する
function fakeFetch(routes: Record<string, Route | ((init: RequestInit) => Route)>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const found = routes[url];
    if (!found) return new Response("not found", { status: 404 });
    const route = typeof found === "function" ? found(init) : found;
    return new Response(toBody(route.body), { status: route.status ?? 200, headers: route.headers ?? {} });
  };
  return { impl, calls };
}

function htmlResponse(html: string | Uint8Array, contentType = "text/html; charset=utf-8"): Route {
  return { status: 200, headers: { "content-type": contentType }, body: html };
}

// --- T1: 取りに行かない URL ---------------------------------------------------

describe("isFetchableUrl（6節: scheme・ホストの検査）", () => {
  it.each([
    ["https://www.amazon.co.jp/dp/B0HJBHHXK2", true],
    ["http://example.com/", true],
    ["ftp://example.com/", false],
    ["file:///etc/passwd", false],
    ["javascript:alert(1)", false],
    ["data:text/html,hi", false],
    ["http://127.0.0.1/", false],
    ["http://10.0.0.1:8787/", false],
    ["http://[::1]/", false],
    ["http://localhost/", false],
    ["http://api.localhost/", false],
    ["http://printer.local/", false],
    ["http://db.internal/", false],
    ["http://LOCALHOST./", false],
    ["not a url", false],
  ])("%s → %s", (url, expected) => {
    expect(isFetchableUrl(url)).toBe(expected);
  });
});

describe("fetchLinkPreview: 取りに行けない URL は fetch を呼ばない（T1）", () => {
  it.each(["http://127.0.0.1/", "http://localhost/", "http://x.local/", "http://x.internal/", "ftp://example.com/"])(
    "%s",
    async (url) => {
      const { impl, calls } = fakeFetch({});
      const preview = await fetchLinkPreview(url, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
      expect(calls).toHaveLength(0);
      expect(preview.image).toBeNull();
      expect(preview.title).toBeNull();
      expect(preview.failures.length).toBeGreaterThan(0);
    },
  );
});

// --- T2: 本物の HTML から拾う ---------------------------------------------------

describe("extractMeta: 段階0で取った本物の HTML（T2）", () => {
  it("Amazon: OGP は無く、<meta name=title> と data-old-hires から取る（先頭 512KB の中にある応答）", () => {
    const meta = extractMeta(amazonHtml, AMAZON_HOST);
    expect(meta.title).toContain("Apple iPhone 18 Pro Max");
    expect(meta.imageUrl).toBe("https://m.media-amazon.com/images/I/71hktoqrWjL._AC_SL1500_.jpg");
  });

  it("Amazon のホストでなければ data-old-hires を拾わない（店ごとの規則はその店にだけ効かせる）", () => {
    const meta = extractMeta(amazonHtml, "shop.example.com");
    expect(meta.imageUrl).toBeNull();
    // <meta name="title"> は店に依らず拾う（6節に列挙してある）
    expect(meta.title).toContain("Apple iPhone 18 Pro Max");
  });

  it("楽天: EUC-JP を Content-Type の charset で復号し、og:title / og:image を取る", () => {
    const html = decodeHtml(rakutenBytes, "text/html;charset=EUC-JP");
    const meta = extractMeta(html, "item.rakuten.co.jp");
    expect(meta.title).toContain("掛け分けマグカップペアセット");
    expect(meta.imageUrl).toBe("https://shop.r10s.jp/afternoon-tea-living/cabinet/item/670/jp8670-01_1.jpg");
  });

  it("楽天: charset を無視して UTF-8 で読むと題名が化ける（復号を charset で選ぶ理由）", () => {
    const html = decodeHtml(rakutenBytes, "text/html");
    const meta = extractMeta(html, "item.rakuten.co.jp");
    expect(meta.title).not.toContain("掛け分けマグカップペアセット");
  });

  it("ユニクロ: og:title / og:image", () => {
    const meta = extractMeta(uniqloHtml, "www.uniqlo.com");
    expect(meta.title).toBe("ユニクロ公式 | クルーネックTシャツ(男女兼用)");
    expect(meta.imageUrl).toBe("https://image.uniqlo.com/UQ/ST3/jp/imagesgoods/422992/item/jpgoods_02_422992_3x4.jpg");
  });

  it("OGP 無し（無印の 520 の本文）・壊れた HTML → 何も取れない", () => {
    expect(extractMeta(mujiBody, "www.muji.com")).toEqual({ title: null, imageUrl: null });
    const broken = '<html><head><meta property="og:image" content="https://x/y.jpg<title>oops</head><meta name="title" content=';
    expect(extractMeta(broken, "example.com").imageUrl).toBeNull();
    expect(extractMeta("", "example.com")).toEqual({ title: null, imageUrl: null });
  });

  it("content が先に来る <meta> と、&amp; の入った URL も拾う", () => {
    const html = '<meta content="https://cdn.example.com/a.jpg?x=1&amp;y=2" property="og:image"><meta property="og:title" content="  題名  ">';
    expect(extractMeta(html, "example.com")).toEqual({ title: "題名", imageUrl: "https://cdn.example.com/a.jpg?x=1&y=2" });
  });

  it("値の中のアポストロフィで切れない（Levi's）。引用符は開いた種類で閉じる", () => {
    const html =
      '<meta property="og:title" content="Levi\'s 501 ジーンズ"><meta property="og:image" content=\'https://cdn.example.com/it"s.jpg\'>' +
      '<img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/x\'y.jpg">';
    expect(extractMeta(html, "example.com")).toEqual({ title: "Levi's 501 ジーンズ", imageUrl: 'https://cdn.example.com/it"s.jpg' });
    const amazonOnly = '<img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/x\'y.jpg">';
    expect(extractMeta(amazonOnly, AMAZON_HOST).imageUrl).toBe("https://m.media-amazon.com/images/I/x'y.jpg");
  });

  it("未知の charset なら UTF-8 で読む（落とさない）", () => {
    const bytes = new TextEncoder().encode('<meta property="og:title" content="日本語">');
    expect(extractMeta(decodeHtml(bytes, "text/html; charset=x-unknown-9"), "example.com").title).toBe("日本語");
  });
});

// 実物の <img id="landingImage" …> をフィクスチャから取り出す（合成に使う）
const LANDING_IMAGE_TAG = amazonHtml.match(/<img[^>]*id="landingImage"[^>]*>/)?.[0] ?? "";

// Amazon の画像ブロックは応答ごとに 325〜612KB の位置にある。`amazon-B07T35N29H-head512k.html` は
// 画像ブロックが 512KB の外にあった応答の先頭 512KB。後ろに実物の <img id="landingImage"> を継ぎ足して
// 「512KB では取れず、1MB なら取れる」を固定する（段階0の決定）
function amazonWithImageBeyond512k(): Uint8Array {
  expect(LANDING_IMAGE_TAG).toContain("data-old-hires");
  const head = new TextEncoder().encode(amazonHead512k);
  expect(head.byteLength).toBeGreaterThan(500 * 1024);
  const filler = new TextEncoder().encode("<div class=\"a-section\"><!-- 段階0の実測で 100KB 以上ずれた位置の埋め --></div>\n");
  const tail = new TextEncoder().encode(`${LANDING_IMAGE_TAG}</body></html>`);
  const target = 620 * 1024;
  const parts: Uint8Array[] = [head];
  let size = head.byteLength;
  while (size < target) {
    parts.push(filler);
    size += filler.byteLength;
  }
  parts.push(tail);
  const out = new Uint8Array(size + tail.byteLength);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

describe("Amazon: 画像ブロックが 512KB の外にある応答（T2）", () => {
  it("先頭 512KB には data-old-hires が無い（フィクスチャの前提）", () => {
    expect(extractMeta(amazonHead512k, AMAZON_HOST).imageUrl).toBeNull();
  });

  it("1MB まで読めば取れる（読み取り上限を 1MB にした根拠を固定する）", () => {
    const bytes = amazonWithImageBeyond512k();
    expect(bytes.byteLength).toBeGreaterThan(512 * 1024);
    expect(bytes.byteLength).toBeLessThan(PAGE_BYTE_LIMIT);
    const html = decodeHtml(bytes, "text/html;charset=UTF-8");
    expect(extractMeta(html, AMAZON_HOST).imageUrl).toBe("https://m.media-amazon.com/images/I/71hktoqrWjL._AC_SL1500_.jpg");
  });

  it("fetchLinkPreview を通しても取れる（1MB で打ち切っても画像ブロックが入る）", async () => {
    const page = "https://www.amazon.co.jp/dp/B07T35N29H";
    const image = "https://m.media-amazon.com/images/I/71hktoqrWjL._AC_SL1500_.jpg";
    const { impl } = fakeFetch({
      [page]: htmlResponse(amazonWithImageBeyond512k(), "text/html;charset=UTF-8"),
      [image]: { headers: { "content-type": "image/jpeg" }, body: bytesOf(JPEG_HEAD, 4096) },
    });
    const preview = await fetchLinkPreview(page, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    expect(preview.image?.contentType).toBe("image/jpeg");
    expect(preview.image?.bytes.byteLength).toBe(4096);
  });
});

// --- 題名の整形（段階0の決定 5） ---------------------------------------------------

describe("normalizeTitle", () => {
  it("Amazon: 前置き「Amazon | 」と末尾の「 | … 通販」を落とし、100 文字で切る", () => {
    const raw = extractMeta(amazonHtml, AMAZON_HOST).title ?? "";
    expect(Array.from(raw).length).toBeGreaterThan(MAX_TITLE);
    const title = normalizeTitle(raw, AMAZON_HOST, MAX_TITLE) ?? "";
    expect(title.startsWith("Apple iPhone 18 Pro Max")).toBe(true);
    expect(title).not.toContain("通販");
    expect(Array.from(title).length).toBeLessThanOrEqual(MAX_TITLE);
  });

  it("Amazon: 「Amazon.co.jp: 」の前置きも落とす", () => {
    expect(normalizeTitle("Amazon.co.jp: サンサンスポンジ 4個セット | キッチンスポンジ 通販", AMAZON_HOST, MAX_TITLE)).toBe(
      "サンサンスポンジ 4個セット",
    );
  });

  it("Amazon 以外は前置き・後置きを触らない。100 文字で切るのは全店共通", () => {
    expect(normalizeTitle("Amazon | 何か | 通販", "example.com", MAX_TITLE)).toBe("Amazon | 何か | 通販");
    expect(normalizeTitle("あ".repeat(150), "example.com", MAX_TITLE)).toBe("あ".repeat(100));
    // サロゲートペアを割らない
    expect(normalizeTitle("😀".repeat(101), "example.com", MAX_TITLE)).toBe("😀".repeat(100));
  });

  it("空白だけ・空になれば null", () => {
    expect(normalizeTitle("   ", "example.com", MAX_TITLE)).toBeNull();
    expect(normalizeTitle("Amazon | ", AMAZON_HOST, MAX_TITLE)).toBeNull();
  });
});

// --- T3: 画像の制限・リダイレクト・時間 ---------------------------------------------

describe("fetchLinkPreview: 画像の制限（T3。失敗しても例外にしない）", () => {
  const page = "https://shop.example.com/item/1";
  const image = "https://cdn.example.com/item.jpg";
  const pageHtml = `<html><head><meta property="og:title" content="商品"><meta property="og:image" content="${image}"></head></html>`;

  async function run(imageRoute: Route) {
    const { impl, calls } = fakeFetch({ [page]: htmlResponse(pageHtml), [image]: imageRoute });
    const preview = await fetchLinkPreview(page, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    return { preview, calls };
  }

  it("正常: jpeg を取って返す。Cookie・認証ヘッダを送らず、User-Agent は nisoine を名乗る", async () => {
    const { preview, calls } = await run({ headers: { "content-type": "image/jpeg" }, body: bytesOf(JPEG_HEAD, 1000) });
    expect(preview.title).toBe("商品");
    expect(preview.image?.contentType).toBe("image/jpeg");
    expect(preview.image?.extension).toBe("jpg");
    expect(preview.image?.bytes.byteLength).toBe(1000);
    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers["user-agent"]).toBe(LINK_PREVIEW_USER_AGENT);
      // 名乗りは nisoine（URL は Worker のまま = 旧名のドメイン。051 T3）
      expect(LINK_PREVIEW_USER_AGENT).toMatch(/^nisoine-link-preview\/1 \(\+https:\/\//);
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("cookie");
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");
      expect(call.init.redirect).toBe("manual");
    }
  });

  it("1MB 超 → 画像無し", async () => {
    const { preview } = await run({ headers: { "content-type": "image/jpeg" }, body: bytesOf(JPEG_HEAD, IMAGE_BYTE_LIMIT + 1) });
    expect(preview.image).toBeNull();
    expect(preview.title).toBe("商品");
    expect(preview.failures.join(" ")).toContain("超えた");
  });

  it("ちょうど 1MB → 取れる", async () => {
    const { preview } = await run({ headers: { "content-type": "image/jpeg" }, body: bytesOf(JPEG_HEAD, IMAGE_BYTE_LIMIT) });
    expect(preview.image?.bytes.byteLength).toBe(IMAGE_BYTE_LIMIT);
  });

  it("許可外の型（image/gif・text/html）→ 画像無し", async () => {
    const gif = await run({ headers: { "content-type": "image/gif" }, body: bytesOf(new Uint8Array([0x47, 0x49, 0x46]), 100) });
    expect(gif.preview.image).toBeNull();
    const html = await run({ headers: { "content-type": "text/html" }, body: "<html>" });
    expect(html.preview.image).toBeNull();
  });

  it("failures に入る Content-Type は 100 文字で切る（外部のヘッダをそのままログに流さない）", async () => {
    const longType = "image/" + "x".repeat(300);
    const { preview } = await run({ headers: { "content-type": longType }, body: bytesOf(JPEG_HEAD, 10) });
    expect(preview.image).toBeNull();
    const line = preview.failures.find((f) => f.includes("許可外")) ?? "";
    expect(line).toContain("image/xxxx");
    expect(line.length).toBeLessThan(160);
  });

  it("Content-Type は image/png だが先頭バイトが JPEG → 画像無し（両方を見る）", async () => {
    const { preview } = await run({ headers: { "content-type": "image/png" }, body: bytesOf(JPEG_HEAD, 100) });
    expect(preview.image).toBeNull();
    expect(preview.failures.join(" ")).toContain("先頭バイト");
  });

  it("png は png として返す（拡張子 png）", async () => {
    const { preview } = await run({ headers: { "content-type": "image/png; charset=binary" }, body: bytesOf(PNG_HEAD, 100) });
    expect(preview.image?.contentType).toBe("image/png");
    expect(preview.image?.extension).toBe("png");
  });

  it("画像が 404 → 画像無し。status と本文の先頭が failures に残る", async () => {
    const { preview } = await run({ status: 404, headers: { "content-type": "text/plain" }, body: "gone" });
    expect(preview.image).toBeNull();
    expect(preview.failures.join(" ")).toContain("404");
    expect(preview.failures.join(" ")).toContain("gone");
  });

  it("画像の URL が IP リテラルなら取りに行かない（行き先も同じ検査）", async () => {
    const html = '<meta property="og:image" content="http://10.0.0.5/secret.jpg">';
    const { impl, calls } = fakeFetch({ [page]: htmlResponse(html) });
    const preview = await fetchLinkPreview(page, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    expect(preview.image).toBeNull();
    expect(calls.map((c) => c.url)).toEqual([page]);
  });

  it("相対 URL の og:image は最終 URL を基準に解決する", async () => {
    const html = '<meta property="og:image" content="/img/a.jpg">';
    const { impl, calls } = fakeFetch({
      [page]: htmlResponse(html),
      "https://shop.example.com/img/a.jpg": { headers: { "content-type": "image/jpeg" }, body: bytesOf(JPEG_HEAD, 10) },
    });
    const preview = await fetchLinkPreview(page, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    expect(calls.map((c) => c.url)).toEqual([page, "https://shop.example.com/img/a.jpg"]);
    expect(preview.image).not.toBeNull();
  });
});

describe("fetchLinkPreview: ページの応答（T3）", () => {
  it("ページが 520（無印）→ 題名も画像も無し。status と本文が failures に残る", async () => {
    const page = "https://www.muji.com/jp/ja/store/cmdty/detail/4550723613880";
    const { impl } = fakeFetch({ [page]: { status: 520, headers: { "content-type": "text/plain" }, body: mujiBody } });
    const preview = await fetchLinkPreview(page, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    expect(preview).toMatchObject({ title: null, image: null });
    expect(preview.failures.join(" ")).toContain("520");
    expect(preview.failures.join(" ")).toContain("error code: 520");
  });

  it("ページは先頭 1MB で打ち切る（それより後ろの og:image は見ない）", async () => {
    const page = "https://shop.example.com/big";
    const padding = "<div>" + "x".repeat(PAGE_BYTE_LIMIT) + "</div>";
    const html = `<html>${padding}<meta property="og:image" content="https://cdn.example.com/late.jpg"></html>`;
    const { impl, calls } = fakeFetch({ [page]: htmlResponse(html) });
    const preview = await fetchLinkPreview(page, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    expect(preview.image).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("fetch が例外を投げても失敗理由を返すだけ（例外にしない）。finalUrl は null", async () => {
    const impl: FetchLike = async () => {
      throw new TypeError("network down");
    };
    const preview = await fetchLinkPreview("https://shop.example.com/", { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    expect(preview).toMatchObject({ title: null, image: null, finalUrl: null });
    expect(preview.failures.join(" ")).toContain("TypeError");
  });
});

describe("fetchLinkPreview: リダイレクト（6節: 3 回まで。行き先も同じ検査）", () => {
  const start = "https://shop.example.com/r0";
  function redirectTo(location: string): Route {
    return { status: 302, headers: { location }, body: null };
  }

  it("3 回までは辿る", async () => {
    const { impl, calls } = fakeFetch({
      [start]: redirectTo("/r1"),
      "https://shop.example.com/r1": redirectTo("/r2"),
      "https://shop.example.com/r2": redirectTo("/r3"),
      "https://shop.example.com/r3": htmlResponse('<meta property="og:title" content="着いた">'),
    });
    const preview = await fetchLinkPreview(start, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    expect(preview.title).toBe("着いた");
    expect(calls).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("4 回目のリダイレクトは辿らない → 何も取れない", async () => {
    const { impl, calls } = fakeFetch({
      [start]: redirectTo("/r1"),
      "https://shop.example.com/r1": redirectTo("/r2"),
      "https://shop.example.com/r2": redirectTo("/r3"),
      "https://shop.example.com/r3": redirectTo("/r4"),
      "https://shop.example.com/r4": htmlResponse('<meta property="og:title" content="来ないはず">'),
    });
    const preview = await fetchLinkPreview(start, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    expect(preview.title).toBeNull();
    expect(calls.map((c) => c.url)).not.toContain("https://shop.example.com/r4");
    expect(preview.failures.join(" ")).toContain("超えた");
  });

  it("Amazon 用の規則は読んだページ（リダイレクト後）のホストで決まる（amzn.asia の短縮 URL）", async () => {
    const short = "https://amzn.asia/d/abc123";
    const product = "https://www.amazon.co.jp/dp/B0HJBHHXK2";
    const image = "https://m.media-amazon.com/images/I/71hktoqrWjL._AC_SL1500_.jpg";
    const { impl, calls } = fakeFetch({
      [short]: redirectTo(product),
      [product]: htmlResponse(amazonHtml, "text/html;charset=UTF-8"),
      [image]: { headers: { "content-type": "image/jpeg" }, body: bytesOf(JPEG_HEAD, 512) },
    });
    const preview = await fetchLinkPreview(short, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    expect(calls.map((c) => c.url)).toEqual([short, product, image]);
    expect(preview.finalUrl).toBe(product);
    expect(preview.image?.contentType).toBe("image/jpeg");
    expect(preview.title?.startsWith("Apple iPhone 18 Pro Max")).toBe(true);
    expect(preview.title).not.toContain("通販");
  });

  it("元の URL が Amazon でも、読んだページが Amazon でなければ Amazon 用の規則は効かない", async () => {
    const start = "https://www.amazon.co.jp/dp/B0HJBHHXK2";
    const elsewhere = "https://shop.example.com/moved";
    const { impl } = fakeFetch({
      [start]: redirectTo(elsewhere),
      [elsewhere]: htmlResponse('<meta name="title" content="Amazon | 何か | 通販"><img id="landingImage" data-old-hires="https://x/y.jpg">'),
    });
    const preview = await fetchLinkPreview(start, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    expect(preview.image).toBeNull();
    expect(preview.title).toBe("Amazon | 何か | 通販");
  });

  it("リダイレクト先が内部（IP リテラル）なら取りに行かない", async () => {
    const { impl, calls } = fakeFetch({ [start]: redirectTo("http://169.254.169.254/latest/meta-data/") });
    const preview = await fetchLinkPreview(start, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
    expect(preview.title).toBeNull();
    expect(calls.map((c) => c.url)).toEqual([start]);
  });
});

describe("fetchLinkPreview: 全体で 12 秒（6節）", () => {
  it("12 秒を超えたら中断し、画像無しで返す", async () => {
    vi.useFakeTimers();
    try {
      const impl: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      const pending = fetchLinkPreview("https://item.rakuten.co.jp/slow/1/", { fetchImpl: impl, maxTitleLength: MAX_TITLE });
      await vi.advanceTimersByTimeAsync(TOTAL_TIMEOUT_MS + 1);
      const preview = await pending;
      expect(preview).toMatchObject({ title: null, image: null });
      expect(preview.failures.join(" ")).toContain(`${TOTAL_TIMEOUT_MS}ms`);
    } finally {
      vi.useRealTimers();
    }
  });

  // ページは即 200 で返り、画像サーバが返さない（drip）ケース。画像の fetch がページと同じ AbortController
  // を共有していなければ、12 秒を超えて待ち続けても誰も気づかない（6節）
  it("画像の fetch もページと同じ 12 秒の期限を共有する（ページは即返り、画像が返らない）", async () => {
    vi.useFakeTimers();
    try {
      const page = "https://shop.example.com/item/drip";
      const image = "https://cdn.example.com/drip.jpg";
      const html = `<meta property="og:title" content="商品"><meta property="og:image" content="${image}">`;
      const impl: FetchLike = (url, init) => {
        if (url === page) return Promise.resolve(new Response(html, { headers: { "content-type": "text/html" } }));
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      };
      const pending = fetchLinkPreview(page, { fetchImpl: impl, maxTitleLength: MAX_TITLE });
      await vi.advanceTimersByTimeAsync(TOTAL_TIMEOUT_MS + 1);
      const preview = await pending;
      expect(preview.image).toBeNull();
      expect(preview.failures.join(" ")).toContain(`${TOTAL_TIMEOUT_MS}ms`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("上限は 12 秒（5 秒では楽天が常に画像無しになる）", () => {
    expect(TOTAL_TIMEOUT_MS).toBe(12_000);
    expect(PAGE_BYTE_LIMIT).toBe(1024 * 1024);
  });
});

describe("sniffImageType", () => {
  it("jpeg / png / webp の先頭バイトを見分ける。それ以外は null", () => {
    expect(sniffImageType(JPEG_HEAD)).toBe("image/jpeg");
    expect(sniffImageType(PNG_HEAD)).toBe("image/png");
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(webp)).toBe("image/webp");
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

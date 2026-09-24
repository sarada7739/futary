import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Bindings } from "../src/index";
import {
  buildCsp,
  extractInlineScripts,
  inlineScriptHashCacheSize,
  sha256Base64,
  STATIC_SECURITY_HEADERS,
} from "../src/lib/security-headers";
import robotsTxt from "../../landing/robots.txt?raw";
import sitemapXml from "../../landing/sitemap.xml?raw";
import landingIndexHtml from "../../landing/index.html?raw";
import landingPrivacyHtml from "../../landing/privacy.html?raw";
import landingTermsHtml from "../../landing/terms.html?raw";
import landingTokushohoHtml from "../../landing/tokushoho.html?raw";
// 053 T4b: 移行前（052 時点）の `pnpm build:public` が書き出した apps/api/public/app/index.html
// （Expo Web エクスポート。inline script 2 本 = Expo Router の hydrate フラグ + +html.tsx の
// 外観の先読み）。`_headers` の CSP のハッシュはこの 2 本から計算されていた
import appIndexHtml from "./fixtures/security-headers/app-index.html?raw";

// 独自ドメイン nisoine.com（053 3節 T1〜T5）。旧ホスト（futary-api.sarada7739.workers.dev）と www は
// nisoine.com へ 301、旧ホストの /api/* は 403、全応答に HSTS、robots.txt・sitemap.xml は静的アセット。
// Worker は Request の URL のホストで判定するので、ホストを変えた URL を app.fetch に渡すだけでよい

const bindings = env as unknown as Bindings;
const LEGACY = "https://futary-api.sarada7739.workers.dev";
const CANONICAL = "https://nisoine.com";

// ASSETS binding の代わり（テスト環境には無い）。apps/landing の実ファイルを ?raw で読み、
// pathname で返す。HTML は inline script を 1 本持つ疑似ページ（CSP のハッシュ計算の検査用）
const INLINE_SCRIPT = 'globalThis.__EXPO_ROUTER_HYDRATE__=true;';
const FAKE_HTML = `<!DOCTYPE html><html><head><script>${INLINE_SCRIPT}</script><script src="/app/x.js"></script></head><body>x</body></html>`;

let assetFetchCount = 0;

function fakeAssets(): Fetcher {
  // binding と同じく html_handling で `/` -> index.html、`/app/` -> app/index.html、
  // `/privacy` -> privacy.html を解決したつもりで返す。ETag は内容ごとに固定
  const files: Record<string, [string, string, string]> = {
    "/robots.txt": [robotsTxt, "text/plain; charset=utf-8", '"robots"'],
    "/sitemap.xml": [sitemapXml, "application/xml", '"sitemap"'],
    "/": [landingIndexHtml, "text/html; charset=utf-8", '"landing-index"'],
    "/privacy": [landingPrivacyHtml, "text/html; charset=utf-8", '"landing-privacy"'],
    "/terms": [landingTermsHtml, "text/html; charset=utf-8", '"landing-terms"'],
    "/tokushoho": [landingTokushohoHtml, "text/html; charset=utf-8", '"landing-tokushoho"'],
    "/app/": [appIndexHtml, "text/html; charset=utf-8", '"app-index"'],
    "/app/index.html": [FAKE_HTML, "text/html; charset=utf-8", '"fake"'],
    "/app/x.js": ["console.log(1)", "text/javascript", '"x-js"'],
    "/assets/favicon.png": ["\x89PNG", "image/png", '"png"'],
  };
  const fetch = async (input: RequestInfo | URL) => {
    assetFetchCount += 1;
    const url = new URL(input instanceof Request ? input.url : String(input));
    const hit = files[url.pathname];
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(hit[0], { status: 200, headers: { "content-type": hit[1], etag: hit[2] } });
  };
  return { fetch } as unknown as Fetcher;
}

// 移行前の `_headers`（052 時点の scripts/build-public.mjs が `/*` に書いていたもの）。値を固定して比べ、
// 黙って弱くならないことを見る。<accountId> は R2_ACCOUNT_ID。frame-ancestors だけ 'none' → 'self'
// （LP が同じオリジンから枠に入れる。056）
const LEGACY_HEADERS_FILE = `/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-cNqZmc0c44BAN5GqZKiHNbeHUp5+VUQq7N7fFL1CwR4=' 'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://<accountId>.r2.cloudflarestorage.com https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self' blob: https://<accountId>.r2.cloudflarestorage.com; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
`;

function legacyHeaders(accountId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of LEGACY_HEADERS_FILE.split("\n")) {
    const m = line.match(/^\s+([A-Za-z-]+): (.+)$/);
    if (m) out[m[1]!.toLowerCase()] = m[2]!.replace(/<accountId>/g, accountId);
  }
  return out;
}

describe("053 T1: 旧ホスト（workers.dev）は nisoine.com へ 301", () => {
  it("GET / → 301 https://nisoine.com/", async () => {
    const res = await app.fetch(new Request(`${LEGACY}/`), bindings);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${CANONICAL}/`);
  });

  it("GET /app/x?y=1&z=2 → 301 同じパス・同じクエリ", async () => {
    const res = await app.fetch(new Request(`${LEGACY}/app/x?y=1&z=2`), bindings);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${CANONICAL}/app/x?y=1&z=2`);
  });

  it("プレビュー URL（<version>-futary-api.sarada7739.workers.dev）も同じ扱い", async () => {
    const res = await app.fetch(new Request("https://abc123-futary-api.sarada7739.workers.dev/privacy"), bindings);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${CANONICAL}/privacy`);
  });
});

describe("053 T2: www.nisoine.com は nisoine.com へ 301", () => {
  it("GET /terms?a=b → 301 https://nisoine.com/terms?a=b", async () => {
    const res = await app.fetch(new Request("https://www.nisoine.com/terms?a=b"), bindings);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${CANONICAL}/terms?a=b`);
  });

  it("nisoine.com 自身は 301 しない（静的アセットへ）", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/robots.txt`), { ...bindings, ASSETS: fakeAssets() });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("localhost（ローカル開発）は 301 しない", async () => {
    const res = await app.fetch(new Request("http://localhost:8787/robots.txt"), { ...bindings, ASSETS: fakeAssets() });
    expect(res.status).toBe(200);
  });
});

describe("053 T3: 旧ホストの /api/* は 301 せず 403 と「開き直して」", () => {
  it("POST /api/health/get → 403・JSON・Location 無し", async () => {
    const res = await app.fetch(new Request(`${LEGACY}/api/health/get`, { method: "POST" }), bindings);
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("LEGACY_ORIGIN");
    expect(body.message).toContain("nisoine.com で開き直してください");
  });

  it("GET /api/auth/get-session（Better Auth の経路）も 403", async () => {
    const res = await app.fetch(new Request(`${LEGACY}/api/auth/get-session`), bindings);
    expect(res.status).toBe(403);
  });

  it("www の /api/* も 403", async () => {
    const res = await app.fetch(new Request("https://www.nisoine.com/api/health/get", { method: "POST" }), bindings);
    expect(res.status).toBe(403);
  });
});

describe("053 T4: 全応答に Strict-Transport-Security（Worker が付ける。_headers は効かない）", () => {
  const hsts = STATIC_SECURITY_HEADERS["Strict-Transport-Security"];

  it("nisoine.com の API 応答", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/api/auth/get-session`), bindings);
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(res.headers.get("strict-transport-security")).toBe(hsts);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("nisoine.com の静的アセット（robots.txt）", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/robots.txt`), { ...bindings, ASSETS: fakeAssets() });
    expect(res.headers.get("strict-transport-security")).toBe(hsts);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("旧ホストの 301 と 403 にも付く", async () => {
    const redirect = await app.fetch(new Request(`${LEGACY}/`), bindings);
    expect(redirect.headers.get("strict-transport-security")).toBe(hsts);
    const forbidden = await app.fetch(new Request(`${LEGACY}/api/health/get`, { method: "POST" }), bindings);
    expect(forbidden.headers.get("strict-transport-security")).toBe(hsts);
  });
});

describe("053 T5: robots.txt / sitemap.xml（apps/landing の実ファイル）", () => {
  it("robots.txt は 200 で /api/ と /app/ を Disallow、sitemap を指す", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/robots.txt`), { ...bindings, ASSETS: fakeAssets() });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/^Disallow: \/api\/$/m);
    expect(text).toMatch(/^Disallow: \/app\/$/m);
    expect(text).toContain("Sitemap: https://nisoine.com/sitemap.xml");
  });

  it("sitemap.xml は 200 で / /privacy /terms /tokushoho を nisoine.com で並べる", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/sitemap.xml`), { ...bindings, ASSETS: fakeAssets() });
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const loc of ["https://nisoine.com/", "https://nisoine.com/privacy", "https://nisoine.com/terms", "https://nisoine.com/tokushoho"]) {
      expect(text).toContain(`<loc>${loc}</loc>`);
    }
    // 旧ホストは無い
    expect(text).not.toContain("workers.dev");
  });

  it("/api/* で一致しないものは binding に渡さず 404", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/api/nothing`), { ...bindings, ASSETS: fakeAssets() });
    expect(res.status).toBe(404);
  });
});

describe("053 T4b: `/` `/app/` `/privacy` の応答ヘッダは移行前の `_headers` と同じ値（固定値と比較）", () => {
  const ACCOUNT = "acct123";
  const expected = legacyHeaders(ACCOUNT);
  const withAssets = () => ({ ...bindings, ASSETS: fakeAssets(), R2_ACCOUNT_ID: ACCOUNT });

  it("固定値の読み取りが正しい（自己検査）", () => {
    expect(Object.keys(expected).sort()).toEqual(
      ["content-security-policy", "referrer-policy", "strict-transport-security", "x-content-type-options"].sort(),
    );
    expect(expected["content-security-policy"]).toContain(`https://${ACCOUNT}.r2.cloudflarestorage.com`);
  });

  it("/app/（Expo の HTML。inline script 2 本）: CSP を含む 4 つのヘッダが移行前と完全に同じ", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/app/`), withAssets());
    expect(res.status).toBe(200);
    for (const [name, value] of Object.entries(expected)) {
      expect(res.headers.get(name), name).toBe(value);
    }
    // ハッシュは実際の inline script から計算した値と一致する（フィクスチャの 2 本を自分で計算）
    const scripts = extractInlineScripts(appIndexHtml);
    expect(scripts).toHaveLength(2);
    for (const s of scripts) {
      expect(res.headers.get("content-security-policy")).toContain(`'sha256-${await sha256Base64(s)}'`);
    }
  });

  it("/ と /privacy（ランディング。inline script 無し）: nosniff・Referrer-Policy・HSTS は同じ。CSP は script-src のハッシュ 2 つが無いだけで他は同じ（狭くなる方向。弱くならない）", async () => {
    const legacyCsp = expected["content-security-policy"]!;
    // 移行前は `/*` に app の 2 本のハッシュが付いていた。ランディングには inline script が
    // 無いので、新しい CSP はそのハッシュを許さない（= より狭い）。それ以外の文字列は同じ
    const legacyCspWithoutHashes = legacyCsp.replace(
      /script-src 'self'( 'sha256-[^']+')+;/,
      "script-src 'self';",
    );
    expect(legacyCspWithoutHashes).not.toBe(legacyCsp);
    for (const path of ["/", "/privacy"]) {
      const res = await app.fetch(new Request(`${CANONICAL}${path}`), withAssets());
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-security-policy"), path).toBe(legacyCspWithoutHashes);
      expect(res.headers.get("x-content-type-options"), path).toBe(expected["x-content-type-options"]);
      expect(res.headers.get("referrer-policy"), path).toBe(expected["referrer-policy"]);
      expect(res.headers.get("strict-transport-security"), path).toBe(expected["strict-transport-security"]);
    }
  });
});

describe("053 T4c: HTML 以外と /api/* には CSP を付けず固定のヘッダだけ", () => {
  it(".js と .png: CSP 無し。nosniff・Referrer-Policy・HSTS はある", async () => {
    for (const path of ["/app/x.js", "/assets/favicon.png"]) {
      const res = await app.fetch(new Request(`${CANONICAL}${path}`), { ...bindings, ASSETS: fakeAssets() });
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-security-policy"), path).toBeNull();
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(res.headers.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("strict-transport-security"), path).toBe("max-age=31536000; includeSubDomains");
    }
  });

  it("/api/*: CSP 無し。固定のヘッダはある", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/api/auth/get-session`), bindings);
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });
});

describe("053: ハッシュはパス + ETag で 1 度だけ計算する（モジュールのメモリ）", () => {
  it("同じパス・同じ ETag の 2 回目は binding から読んだ本文をそのまま流し、キャッシュの数が増えない", async () => {
    const env2 = { ...bindings, ASSETS: fakeAssets(), R2_ACCOUNT_ID: "acct123" };
    const first = await app.fetch(new Request(`${CANONICAL}/app/`), env2);
    const sizeAfterFirst = inlineScriptHashCacheSize();
    expect(sizeAfterFirst).toBeGreaterThanOrEqual(1);
    const second = await app.fetch(new Request(`${CANONICAL}/app/`), env2);
    expect(inlineScriptHashCacheSize()).toBe(sizeAfterFirst);
    expect(second.headers.get("content-security-policy")).toBe(first.headers.get("content-security-policy"));
    expect(await second.text()).toBe(appIndexHtml);
    // binding 自体は毎回呼ばれる（応答の本文は binding のもの。キャッシュするのはハッシュだけ）
    expect(assetFetchCount).toBeGreaterThanOrEqual(2);
  });

  it("ETag が違えば計算し直す（内容が変わったデプロイ）", async () => {
    const before = inlineScriptHashCacheSize();
    const changed = {
      fetch: async () =>
        new Response(FAKE_HTML, { status: 200, headers: { "content-type": "text/html", etag: '"v2"' } }),
    } as unknown as Fetcher;
    const res = await app.fetch(new Request(`${CANONICAL}/app/`), { ...bindings, ASSETS: changed, R2_ACCOUNT_ID: "a" });
    expect(res.headers.get("content-security-policy")).toContain(`'sha256-${await sha256Base64(INLINE_SCRIPT)}'`);
    expect(inlineScriptHashCacheSize()).toBe(before + 1);
  });
});

describe("053: CSP は Worker が配信する HTML から inline script のハッシュを計算して付ける", () => {
  it("HTML の応答に CSP が付き、script-src に inline script の sha256 が入る（src 付きは対象外）", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/app/index.html`), {
      ...bindings,
      ASSETS: fakeAssets(),
      R2_ACCOUNT_ID: "acct123",
    });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    const expectedHash = `'sha256-${await sha256Base64(INLINE_SCRIPT)}'`;
    expect(csp).toContain(`script-src 'self' ${expectedHash};`);
    // build-public.mjs が書いていた `_headers` の CSP と同じ形
    expect(csp).toBe(buildCsp([expectedHash.slice(1, -1)], "acct123"));
    expect(csp).toContain("https://acct123.r2.cloudflarestorage.com");
    // LP が同じオリジンから枠に入れる。他サイトは拒む（056）
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("'none'; object-src");
    // 本文はそのまま
    expect(await res.text()).toBe(FAKE_HTML);
  });

  it("R2_ACCOUNT_ID が無ければ R2 のホストを足さない（fail-closed。広げない）", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/app/index.html`), {
      ...bindings,
      ASSETS: fakeAssets(),
      R2_ACCOUNT_ID: undefined,
    });
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("r2.cloudflarestorage.com");
    expect(csp).not.toContain("*");
  });

  it("HTML 以外（JS）には CSP を付けない。固定のヘッダは付く", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/app/x.js`), { ...bindings, ASSETS: fakeAssets() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("extractInlineScripts は build-public.mjs と同じ規則（src 属性の位置に依らず除外、本文の < を越えて読む）", () => {
    const html =
      '<script type="module" src="/a.js"></script>' +
      "<script>if (1 < 2) { x() }</script>" +
      '<script data-x="y">y()</script>';
    expect(extractInlineScripts(html)).toEqual(["if (1 < 2) { x() }", "y()"]);
  });
});

// /tokushoho が 200。terms.html に「8. プレミアム」があり節番号が 8〜11。「【」（空欄の埋め忘れ）が無い。
// 特商法の価格は Stripe の設定と同じ（月 420・年 4,200。048）
describe("048 P7b: /tokushoho と利用規約 8 節", () => {
  it("/tokushoho は 200 の HTML で、販売業者・価格・支払方法・解約・返金の行がある", async () => {
    const res = await app.fetch(new Request(`${CANONICAL}/tokushoho`), { ...bindings, ASSETS: fakeAssets() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<title>特定商取引法に基づく表記 - Nisoine</title>");
    for (const label of ["販売業者", "販売価格", "支払方法", "解約について", "返品・返金について"]) {
      expect(html).toContain(`<td>${label}</td>`);
    }
    expect(html).toContain("月額 420 円（税込）／年額 4,200 円（税込）");
    expect(html).not.toContain("【");
    expect(html).toContain('href="/terms"');
  });

  it("terms.html: 「8. プレミアム（有料プラン）」があり、見出しは 1〜11 で欠番無し", () => {
    const headings = [...landingTermsHtml.matchAll(/<h3>(\d+)\. ([^<]+)<\/h3>/g)].map((m) => [Number(m[1]), m[2]] as const);
    expect(headings.map(([n]) => n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(headings[7]).toEqual([8, "プレミアム（有料プラン）"]);
    expect(headings[8]).toEqual([9, "規約の変更"]);
    expect(headings[10]).toEqual([11, "連絡先"]);
    expect(landingTermsHtml).toContain('href="/tokushoho"');
    expect(landingTermsHtml).not.toContain("【");
    // 文中の相互参照「プライバシーポリシー 2 節」「4 節」は詰めた範囲より前
    expect(landingTermsHtml).toContain("プライバシーポリシー 2 節");
  });
});

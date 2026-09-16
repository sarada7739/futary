import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Bindings } from "../src/index";
import landingIndexHtml from "../../landing/index.html?raw";
import landingTechHtml from "../../landing/tech.html?raw";
import landingPrivacyHtml from "../../landing/privacy.html?raw";
import landingTermsHtml from "../../landing/terms.html?raw";
import landingTokushohoHtml from "../../landing/tokushoho.html?raw";
import landingSitemapXml from "../../landing/sitemap.xml?raw";
import landingAssets from "virtual:landing-assets";

// 054: ランディングページを一般向けに作り直す（docs/tasks/054-landing-for-users.md 5節 T1〜T5）。
// T6（`/` の応答ヘッダが 053 の T4b と同じ）は canonical-host.test.ts の既存のテストがそのまま緑。
// ASSETS binding はテスト環境に無いので、apps/landing の実ファイルを ?raw で読んで返す
// （canonical-host.test.ts と同じ形。html_handling が `/tech` -> `tech.html` を解くつもりで返す）

const bindings = env as unknown as Bindings;
const CANONICAL = "https://nisoine.com";

function fakeAssets(): Fetcher {
  const files: Record<string, string> = {
    "/": landingIndexHtml,
    "/tech": landingTechHtml,
    "/privacy": landingPrivacyHtml,
    "/terms": landingTermsHtml,
    "/tokushoho": landingTokushohoHtml,
  };
  const fetch = async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const hit = files[url.pathname];
    if (hit === undefined) return new Response("not found", { status: 404 });
    return new Response(hit, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", etag: `"landing${url.pathname.replace(/\//g, "-")}"` },
    });
  };
  return { fetch } as unknown as Fetcher;
}

const get = (path: string) => app.fetch(new Request(`${CANONICAL}${path}`), { ...bindings, ASSETS: fakeAssets() });

describe("054 T1: `/` と `/tech` が 200。技術構成の節は `/tech` にだけある", () => {
  it("GET / → 200。「技術構成」の節（tech-heading・decisions・GitHub のリンク）が無い", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('id="tech-heading"');
    expect(html).not.toContain('class="decisions"');
    expect(html).not.toContain("GitHubリポジトリを見る");
    // フッターの「技術構成」からだけ辿れる
    expect(html).toContain('<a href="/tech">技術構成</a>');
  });

  it("GET /tech → 200。技術構成の節を文言ごと持ち、<title> と canonical が定義どおり", async () => {
    const res = await get("/tech");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Nisoine の技術構成</title>");
    expect(html).toContain('<link rel="canonical" href="https://nisoine.com/tech" />');
    expect(html).toContain('id="tech-heading"');
    expect(html).toContain("認可を1箇所に集約する");
    expect(html).toContain("記念日・予定・会った日を1テーブルに統合する");
    expect(html).toContain("「去年の今日」を「思い出し」に一般化する");
    expect(html).toContain("デモは未認証・閲覧専用");
    expect(html).toContain("https://github.com/sarada7739/futary/blob/main/docs/decisions.md");
    expect(html).toContain("GitHubリポジトリを見る");
  });

  it("sitemap.xml に /tech は無い（0節 #1）", () => {
    expect(landingSitemapXml).not.toContain("/tech");
  });
});

describe("054 T2: `/` と `/tech` の HTML に <script が無い（CSP のハッシュが要らないまま）", () => {
  it.each([
    ["/", landingIndexHtml],
    ["/tech", landingTechHtml],
  ])("%s", (_path, html) => {
    expect(html).not.toMatch(/<script/i);
    // style 属性も使わない（0節 #13）
    expect(html).not.toMatch(/\sstyle=/i);
  });
});

describe("054 T3: `/` の <img> 全部に width と height がある", () => {
  it("img タグを数え、width・height の無いものが 0", () => {
    const imgs = [...landingIndexHtml.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThanOrEqual(20);
    const missing = imgs.filter((tag) => !/\bwidth="\d+"/.test(tag) || !/\bheight="\d+"/.test(tag));
    expect(missing).toEqual([]);
    // ヒーロー以外は loading="lazy"（0節 #8）。ヒーローと（画面の上にある）ヘッダーのロゴだけが lazy でない
    const eager = imgs.filter((tag) => !/\bloading="lazy"/.test(tag));
    expect(eager).toHaveLength(2);
    expect(eager.some((tag) => tag.includes("hero-beach.jpg"))).toBe(true);
    expect(eager.some((tag) => tag.includes("logo.png"))).toBe(true);
  });
});

describe("054 T4: apps/landing/assets/ の JPEG は 1 枚 250KB 以下・合計 1.5MB 以下", () => {
  const jpegs = landingAssets.filter((f) => f.name.endsWith(".jpg"));

  it("054 で置いた 11 枚がある（役割の名前）", () => {
    expect(jpegs.map((f) => f.name).sort()).toEqual(
      [
        "ai-network.jpg",
        "avatar-ren.jpg",
        "avatar-yui.jpg",
        "calendar-desk.jpg",
        "hands-cafe.jpg",
        "hero-beach.jpg",
        "phone-chat.jpg",
        "phone-photos.jpg",
        "polaroid-softcream.jpg",
        "polaroid-three.jpg",
        "want-grid.jpg",
      ].sort(),
    );
  });

  it("1 枚 250KB 以下", () => {
    const over = jpegs.filter((f) => f.bytes > 250 * 1024);
    expect(over).toEqual([]);
  });

  it("合計 1.5MB 以下", () => {
    const total = jpegs.reduce((sum, f) => sum + f.bytes, 0);
    expect(total).toBeLessThanOrEqual(1.5 * 1024 * 1024);
  });

  it("index.html が参照する /assets/ のファイルは全部ある（写真・線画・ロゴ）", () => {
    const names = new Set(landingAssets.map((f) => f.name));
    const referenced = [...landingIndexHtml.matchAll(/\/assets\/([\w.-]+)/g)].map((m) => m[1]!);
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((name) => !names.has(name))).toEqual([]);
  });
});

describe("054 T5: `/privacy` `/terms` `/tokushoho` が 200（style.css の書き直しで壊れていない）", () => {
  it.each(["/privacy", "/terms", "/tokushoho"])("%s → 200 で /style.css を読む", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<link rel="stylesheet" href="/style.css" />');
    // 法務ページが使うクラスは style.css に残っている（T5 の実体。見た目は artifacts/054 のキャプチャ）
    expect(html).toContain('class="hero"');
    expect(html).toContain('class="decisions"');
  });
});

describe("054: 文言（3節）とリンク", () => {
  it("「はじめる」→ /app/ が 4 箇所（ヘッダー・ヒーロー・プレミアム・最後）。デモとプレミアムのリンク", () => {
    const starts = landingIndexHtml.match(/<a\b[^>]*href="\/app\/"[^>]*>はじめる<\/a>/g) ?? [];
    expect(starts).toHaveLength(4);
    expect(landingIndexHtml).toContain('href="/app/">ログインせずにデモを見る</a>');
    expect(landingIndexHtml).toContain('href="/app/premium">プレミアムを見る →</a>');
    expect(landingIndexHtml).toContain("今はブラウザで使えます。Google Play は準備中です。");
  });

  it("価格は静的に ¥420 / ¥4,200。写真は 50 万枚（無料は 30 枚）。5 万枚は無い", () => {
    expect(landingIndexHtml).toContain("¥420");
    expect(landingIndexHtml).toContain("¥4,200");
    expect(landingIndexHtml).toContain("写真を 50 万枚まで保存");
    expect(landingIndexHtml).toContain("無料プランは 30 枚まで");
    expect(landingIndexHtml).not.toContain("5 万枚");
  });

  it("絵にあって Nisoine に無いものは載せない（質問・みんなの声・30GB・通報・レビュー）", () => {
    // HTML のコメント（030 の R レビューの注）は見せる文言ではないので外す
    const visible = landingIndexHtml.replace(/<!--[\s\S]*?-->/g, "");
    for (const ng of ["1 日 3 回", "1日3回", "みんなの声", "30GB", "通報", "レビュー", "デッキ", "ブラインド"]) {
      expect(visible, ng).not.toContain(ng);
    }
  });

  it("description と og:description は 3 節のとおり", () => {
    expect(landingIndexHtml).toContain(
      'name="description" content="Nisoineは、ふたりだけの毎日を残す専用SNS。タイムライン・カレンダー・思い出・アルバム・AIまとめ。基本機能は無料。ブラウザですぐに使えます。"',
    );
    expect(landingIndexHtml).toContain(
      'property="og:description" content="ふたりだけの毎日を残す専用SNS。基本機能は無料、ブラウザですぐに使えます。"',
    );
  });
});

describe("047 T10: 法務ページと LP の文言が鍵の実装と一致する", () => {
  it("/tokushoho の「解約後のデータについて」が草案の文面（30 日の猶予・ZIP で保存・削除しません）", async () => {
    const res = await get("/tokushoho");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(
      "<tr><td>解約後のデータについて</td><td>プレミアムをやめると、無料プランの範囲（アルバムの写真 30 枚まで）を超える写真は、期間の終わりから 30 日の猶予ののち閲覧できなくなります。猶予の間に「ZIP で保存」で手元に控えることができます。再びプレミアムにすると閲覧できるようになります。データは削除しません</td></tr>",
    );
    expect(html).not.toContain("新しく追加できなくなります");
  });

  it("/terms 8 節に「30 日の猶予」の行（草案の文面）", async () => {
    const res = await get("/terms");
    const html = await res.text();
    expect(html).toContain(
      "<li>プレミアムをやめた場合、無料プランの範囲を超える写真は、期間の終わりから 30 日の猶予ののち閲覧できなくなります。猶予の間に「ZIP で保存」で手元に控えてください。写真は削除されず、再びプレミアムにすると閲覧できます</li>",
    );
    expect(html).not.toContain("新しく追加できなくなります");
  });

  it("/ の FAQ に「いつでも ZIP」が無い（鍵の写真は ZIP に入らない）", () => {
    expect(landingIndexHtml).not.toContain("いつでも ZIP");
    expect(landingIndexHtml).toContain("写真は ZIP でまとめて持ち出せます。");
  });
});

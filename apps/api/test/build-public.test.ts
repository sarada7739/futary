import { describe, expect, it } from "vitest";
import landingIndexHtml from "../../landing/index.html?raw";
import landingTechHtml from "../../landing/tech.html?raw";
import { styleCss as landingStyleCss } from "virtual:landing-assets";
import { stripCssComments, stripHtmlComments } from "../../../scripts/build-public.mjs";

// 060: 本番の LP からコメントを落とす（docs/tasks/060-strip-comments-on-build.md 2節 T1〜T4）。
// ソース（apps/landing/）は landing.test.ts が見る。ここは「出力」= strip* を通した結果を見る。
// build-public.mjs は入口のときだけ main() を走らせる（0節 #4）ので、ここから import しても
// apps/api/public は作り直されない

describe("060 T1: stripHtmlComments", () => {
  it("<!-- a --> が消える", () => {
    expect(stripHtmlComments("x<!-- a -->y")).toBe("xy");
  });

  it("複数行のコメントが消える", () => {
    expect(stripHtmlComments("<p>a</p>\n<!-- 1 行目\n     2 行目 -->\n<p>b</p>")).toBe("<p>a</p>\n\n<p>b</p>");
  });

  it("--> を越えて次のコメントまで食わない（間の文字は残る）", () => {
    expect(stripHtmlComments("<!-- a --> x <!-- b -->")).toBe(" x ");
  });

  it("コメントの無い文字列はそのまま", () => {
    const html = '<section class="demo" id="demo">\n  <p>デモ画面です。</p>\n</section>\n';
    expect(stripHtmlComments(html)).toBe(html);
  });
});

describe("060 T2: stripCssComments", () => {
  it("/* a */ が消える", () => {
    expect(stripCssComments("a{/* a */color:red}")).toBe("a{color:red}");
  });

  it("複数行のコメントが消える", () => {
    expect(stripCssComments("/* 1 行目\n   2 行目 */\na{}")).toBe("\na{}");
  });

  it("*/ を越えて食わない（間の規則は残る）", () => {
    expect(stripCssComments("/* a */ b{} /* c */")).toBe(" b{} ");
  });

  it('content: "✓" のような文字列はそのまま', () => {
    const css = '.x::before { content: "✓"; }\n.y::before { content: ""; }\n.z::before { content: "+"; }\n';
    expect(stripCssComments(css)).toBe(css);
  });
});

describe("060 T3: 実物の style.css の content: と url( の中に /* が無い（0節 #3 の前提）", () => {
  it("content: の値は \"\"・\"✓\"・\"+\"・\"−\" だけで、/* を含まない", () => {
    const contents = [...landingStyleCss.matchAll(/^\s*content:\s*([^;]+);/gm)].map((m) => m[1]!.trim());
    expect(contents.length).toBeGreaterThan(0);
    expect(new Set(contents)).toEqual(new Set(['""', '"✓"', '"+"', '"−"']));
    expect(contents.some((v) => v.includes("/*"))).toBe(false);
  });

  it("url( の中に /* が無い", () => {
    const urls = [...landingStyleCss.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]!);
    expect(urls.some((v) => v.includes("/*"))).toBe(false);
  });
});

describe("060 T4: 実物の index.html・tech.html・style.css を通した結果", () => {
  const index = stripHtmlComments(landingIndexHtml);
  const tech = stripHtmlComments(landingTechHtml);
  const css = stripCssComments(landingStyleCss);

  it("ソースにはコメントがあり、通した結果には <!-- と /* が 0 個", () => {
    expect(landingIndexHtml).toContain("<!--");
    expect(landingStyleCss).toContain("/*");
    expect(index.match(/<!--/g) ?? []).toHaveLength(0);
    expect(tech.match(/<!--/g) ?? []).toHaveLength(0);
    expect(css.match(/\/\*/g) ?? []).toHaveLength(0);
    expect(css.match(/\*\//g) ?? []).toHaveLength(0);
  });

  it("054・056・059 の固定値は残る（iframe・section.demo・.demo-inner・padding: 22px;）", () => {
    expect(index).toContain("<iframe");
    expect(index).toContain('<section class="demo"');
    expect(css).toContain(".demo-inner");
    expect(css).toContain("padding: 22px;");
    expect(tech).toContain("技術構成");
  });

  it("タスク番号・内部の文書のパスが出力に無い（目的の確認）", () => {
    expect(index).not.toMatch(/docs\/tasks\//);
    expect(index).not.toMatch(/artifacts\//);
    expect(css).not.toMatch(/docs\/tasks\//);
    expect(css).not.toMatch(/artifacts\//);
  });
});

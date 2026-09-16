// 054: LP の全画面キャプチャ（PC 1280・スマホ 375）と、横スクロールが無いことの計測。
// wrangler dev（api-dev。apps/api/public に landing を複製した状態）に対して実行する。
//   node artifacts/054/scripts/capture.mjs http://localhost:8787 artifacts/054
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const [baseURL = "http://localhost:8787", outDir = "artifacts/054"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const results = [];
for (const [name, width, height, pagePath] of [
  ["pc-1280", 1280, 900, "/"],
  ["mobile-375", 375, 812, "/"],
  ["tech-pc-1280", 1280, 900, "/tech"],
  ["tech-mobile-375", 375, 812, "/tech"],
  ["privacy-mobile-375", 375, 812, "/privacy"],
  ["tokushoho-mobile-375", 375, 812, "/tokushoho"],
]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`${baseURL}${pagePath}`, { waitUntil: "networkidle" });
  // loading="lazy" の写真は画面に近づくまで読まれない。下まで一度スクロールして全部読ませてから撮る
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, 0);
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
  });
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    // 画面幅より右へはみ出す要素（overflow-x: hidden の裏で隠れているもの）
    overflowing: [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
      .slice(0, 10),
    scripts: document.querySelectorAll("script").length,
    imgsWithoutSize: [...document.querySelectorAll("img")].filter((i) => !i.getAttribute("width") || !i.getAttribute("height")).length,
  }));
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  results.push({ name, ...m });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));

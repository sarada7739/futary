// 065: LP の AI まとめの帯の、帯と文字の塊の上下の余白を測り、帯を撮る（Chromium）。
//   node artifacts/065/scripts/measure.mjs <outDir> [css ファイル]
// apps/landing の index.html を file:// で開き、style.css の代わりに渡した CSS を読ませる
// （既定は apps/landing/style.css）。375 幅と 1280 幅で測る
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const [outDir = "out", cssFile = "apps/landing/style.css"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const landing = path.resolve("apps/landing");
const css = readFileSync(cssFile, "utf8");

const browser = await chromium.launch();
for (const width of [375, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  // /style.css・/assets/… の絶対パスを apps/landing のファイルで応える
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "file:" && url.pathname.endsWith("/style.css")) {
      return route.fulfill({ contentType: "text/css", body: css });
    }
    if (url.protocol === "file:" && url.pathname.includes("/assets/")) {
      const name = url.pathname.split("/assets/").pop();
      return route.fulfill({ body: readFileSync(path.join(landing, "assets", name)) });
    }
    return route.continue();
  });
  await page.goto(pathToFileURL(path.join(landing, "index.html")).href);
  const band = page.locator(".ai-band");
  await band.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const m = await band.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const copy = el.querySelector(".ai-band-copy");
    const c = copy.getBoundingClientRect();
    // 文字の塊の中身（h2 の上端〜p の下端）
    const h2 = copy.querySelector("h2").getBoundingClientRect();
    const p = copy.querySelector("p").getBoundingClientRect();
    const lines = Math.round(p.height / parseFloat(getComputedStyle(copy.querySelector("p")).lineHeight));
    return {
      band: Math.round(b.height),
      copyBox: [Math.round(c.top - b.top), Math.round(b.bottom - c.bottom)],
      text: [Math.round(h2.top - b.top), Math.round(b.bottom - p.bottom)],
      pLines: lines,
      pText: copy.querySelector("p").textContent,
    };
  });
  console.log(`${width}px: 帯の高さ ${m.band} / 文字の塊の箱 上 ${m.copyBox[0]}・下 ${m.copyBox[1]} / 文字 上 ${m.text[0]}・下 ${m.text[1]} / 説明 ${m.pLines} 行`);
  await band.screenshot({ path: path.join(outDir, `ai-band-${width}.png`) });
  await page.close();
}
await browser.close();

// 068 追補 2: 画面の上（島のあったあたり）を、WebGL の層あり・なしで撮り比べる（点が WebGL から出ているかを見る）。
//   node artifacts/068/scripts/dots.mjs <outDir>（先に pnpm build:public → api-dev）
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:8787/");
await page.locator("#demo").scrollIntoViewIfNeeded();
await page.locator("canvas.phone3d-gl").waitFor({ timeout: 15000 });
await page.waitForTimeout(2500);
const r = await page.locator(".phone .phone-screen").evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; });
const clip = { x: r.x, y: r.y, width: r.w, height: 60 };
await page.screenshot({ path: `${out}/dots-with-gl.png`, clip });
await page.evaluate(() => { document.querySelector("canvas.phone3d-gl").style.visibility = "hidden"; });
await page.screenshot({ path: `${out}/dots-no-gl.png`, clip });
// GL の canvas の中身（アルファ）を読む: 島のあたりの画素のアルファ
const alpha = await page.evaluate(() => {
  const c = document.querySelector("canvas.phone3d-gl");
  const tmp = document.createElement("canvas"); tmp.width = c.width; tmp.height = c.height;
  const ctx = tmp.getContext("2d"); ctx.drawImage(c, 0, 0);
  const cx = Math.round(c.width / 2); const y0 = Math.round(c.height * 0.06); const y1 = Math.round(c.height * 0.16);
  const d = ctx.getImageData(cx - 150, y0, 300, y1 - y0).data;
  let nonzero = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) nonzero++;
  return { nonzero, total: d.length / 4 };
});
console.log(JSON.stringify(alpha));
await browser.close();

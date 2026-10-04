// 068 追補 3: 斜めの向き（y・x の符号）の 4 通りを、正面の位置でドラッグして撮る（向きを見比べて決めるため）。
//   node artifacts/068/scripts/direction.mjs <outDir>（先に pnpm build:public → api-dev）
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:8787/");
await page.locator("#demo").scrollIntoViewIfNeeded();
await page.locator("canvas.phone3d-gl").waitFor({ timeout: 15000 });
await page.evaluate(() => { const r = document.querySelector(".phone").getBoundingClientRect(); window.scrollBy(0, r.top - 30); });
await page.waitForTimeout(1500);
const box = await page.locator(".phone").boundingBox();
// ドラッグ 1px = 0.006 rad。y 0.44 = 73px・x 0.14 = 23px
for (const [name, dx, dy] of [["yplus-xminus", 73, -23], ["yminus-xplus", -73, 23], ["yplus-xplus", 73, 23], ["yminus-xminus", -73, -23]]) {
  const sx = box.x + 30, sy = box.y + 300;
  await page.mouse.move(sx, sy); await page.mouse.down();
  await page.mouse.move(sx + dx, sy + dy, { steps: 6 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/dir-${name}.png`, clip: { x: box.x - 40, y: box.y - 20, width: box.width + 80, height: box.height + 40 } });
  await page.mouse.up(); await page.waitForTimeout(1200);
}
await browser.close();

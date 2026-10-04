// 068 追補: 上下・左右を組み合わせた 4 つの傾きで撮る（画面に縞が出ないことを見る）。
//   node artifacts/068/scripts/angles.mjs <outDir>（先に pnpm build:public → api-dev）
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:8787/");
await page.locator("#demo").scrollIntoViewIfNeeded();
await page.locator("canvas.phone3d-gl").waitFor({ timeout: 15000 });
await page.waitForTimeout(2500);
const box = await page.locator(".phone").boundingBox();
const sx = box.x + 30, sy = box.y + box.height / 2;
for (const [name, dx, dy] of [["a", 60, 60], ["b", 120, -70], ["c", -90, 80], ["d", 200, 80]]) {
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(sx + (dx * i) / 8, sy + (dy * i) / 8); await page.waitForTimeout(16); }
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, `angle-${name}.png`), clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 } });
  await page.mouse.up();
  await page.waitForTimeout(1000);
}
await browser.close();

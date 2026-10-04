// 068 追補 2: デモの画面の画質（文字のくっきりさ）を 2D と 3D で比べる。
//   node artifacts/068/scripts/sharpness.mjs <outDir> [deviceScaleFactor=1]
// 同じ画面（ホーム）を、2D（prefers-reduced-motion: reduce の判定を使わず、3D を組まない 2D の枠）と 3D（正面で止まったとき）で
// 撮り、iframe の中央の帯を切り出して PNG に書く。くっきりさは python で数える（ラプラシアンの分散）
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const [outDir = "out", dsf = "1"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

async function shoot(name, contextOptions, block3d) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: Number(dsf), ...contextOptions });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("futary.releaseSeen", "9.9.9");
      window.localStorage.setItem("futary.weatherPromptDismissed", "1");
    } catch {
      // 無ければそのまま
    }
  });
  const page = await context.newPage();
  // 2D を撮るときは /phone3d.js を読ませない（3D を組まない）
  if (block3d) await page.route("**/phone3d.js", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
  await page.goto("http://localhost:8787/");
  await page.locator("#demo").scrollIntoViewIfNeeded();
  if (!block3d) await page.locator("canvas.phone3d-gl").waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector(".phone .phone-screen")?.contentDocument?.body?.innerText.includes("付き合って"), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const r = await page.locator(".phone .phone-screen").evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  // 中央の帯（記念日のカードのあたり）
  await page.screenshot({ path: path.join(outDir, `${name}.png`), clip: { x: r.x + r.w * 0.1, y: r.y + r.h * 0.12, width: r.w * 0.8, height: r.h * 0.28 } });
  console.log(name, JSON.stringify(r));
  await context.close();
}

await shoot(`2d-dsf${dsf}`, {}, true);
await shoot(`3d-dsf${dsf}`, {}, false);
await browser.close();

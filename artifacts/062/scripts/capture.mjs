// 062: ホームの機能パネル（ピンクもホワイトと同じ写真タイル）。375 幅で両外観のホームを撮り、
// パネルの写真の数と 1 枚目の寸法（正方形か）を記録する。
//   node artifacts/062/scripts/capture.mjs http://localhost:8081 artifacts/062 session-cookie.txt
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const [baseURL = "http://localhost:8081", outDir = "artifacts/062", cookieFile = "session-cookie.txt"] = process.argv.slice(2);
const apiOrigin = "http://localhost:8787";
mkdirSync(outDir, { recursive: true });
const cookieValue = readFileSync(cookieFile, "utf8").trim();
const sessionCookie = { name: "better-auth.session_token", value: cookieValue, url: apiOrigin, httpOnly: true, sameSite: "Lax" };

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
}

const record = { pink: {}, white: {}, consoleErrors: [] };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
await context.addCookies([sessionCookie]);
const page = await context.newPage();
page.setDefaultNavigationTimeout(180000);
page.on("console", (m) => {
  if (m.type() === "error") record.consoleErrors.push(m.text());
});
await page.goto(`${baseURL}/`, { timeout: 180000 });
await page.getByTestId("stats-card-days-number").waitFor({ timeout: 180000 });

for (const mode of ["pink", "white"]) {
  await page.evaluate((m) => {
    window.localStorage.setItem("futary.releaseSeen", "3.3.0");
    window.localStorage.setItem("futary.weatherPromptDismissed", "1");
    if (m === "pink") window.localStorage.removeItem("futary.appearance");
    else window.localStorage.setItem("futary.appearance", m);
  }, mode);
  await page.reload();
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 60000 });
  await settle(page);
  record[mode] = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('[data-testid="feature-panel"]')];
    const photos = [...document.querySelectorAll('[data-testid="feature-panel-photo"]')];
    const first = panels[0]?.getBoundingClientRect();
    const tile = photos[0]?.getBoundingClientRect();
    const body = document.body.textContent ?? "";
    return {
      panels: panels.length,
      photos: photos.length,
      panelSize: first ? { w: Math.round(first.width), h: Math.round(first.height) } : null,
      tileSize: tile ? { w: Math.round(tile.width), h: Math.round(tile.height) } : null,
      panelBorderColor: panels[0] ? getComputedStyle(panels[0]).borderColor : null,
      panelBoxShadow: panels[0] ? getComputedStyle(panels[0]).boxShadow : null,
      hasComingSoon: body.includes("COMING SOON"),
      hasKinjitsu: body.includes("近日公開"),
    };
  });
  await page.screenshot({ path: path.join(outDir, `${mode}-home.png`), fullPage: true });
  const grid = page.getByTestId("feature-panel").first();
  await grid.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, `${mode}-home-viewport.png`) });
}
await context.close();
await browser.close();
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2), "utf8");
console.log(JSON.stringify(record, null, 2));

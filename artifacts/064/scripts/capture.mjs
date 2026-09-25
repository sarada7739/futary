// 064: ローカルのデモ（/?demo=1）の「ほしいもの」を撮る（iPhone 幅 375×812・Chromium）。
//   node artifacts/064/scripts/capture.mjs <outDir> [baseURL]
// ローカルの API が返す画像の署名付き URL は本番の R2 を指し、seed:local の画像はローカルのバケットにしか
// 無いので、そのままでは画像が出ない。撮影に限り、wants/demo-want-image-*.jpg への要求を同梱の画像
// （packages/db/seed/assets/）で応える。本番は seed:remote で同じ画像が R2 に置かれる
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const [outDir = "out", baseURL = "http://localhost:8081"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const assets = path.resolve("packages/db/seed/assets");
const assetFor = { "demo-want-image-gunze.jpg": "want-gunze.jpg", "demo-want-image-mug.jpg": "want-mug.jpg" };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const substituted = [];
await context.route(/\/couples\/demo-couple\/wants\/demo-want-image-[a-z]+\.jpg/, async (route) => {
  const name = new URL(route.request().url()).pathname.split("/").pop();
  const file = assetFor[name];
  substituted.push(name);
  await route.fulfill({ status: 200, contentType: "image/jpeg", body: readFileSync(path.join(assets, file)) });
});
const page = await context.newPage();
// 新機能のお知らせ・地域の案内が画面を覆わないよう、最新の版を既読にしておく（apps/app/lib/releases.ts の先頭）
const latestVersion = readFileSync("apps/app/lib/releases.ts", "utf8").match(/version: "(\d+\.\d+\.\d+)"/)[1];
await page.addInitScript((version) => {
  window.localStorage.setItem("futary.releaseSeen", version);
  window.localStorage.setItem("futary.weatherPromptDismissed", "1");
}, latestVersion);
await page.goto(`${baseURL}/?demo=1`);
// パネルは下の方にあり、スクロールの外側の層と重なるので、DOM の click で押す
const wantPanel = page.getByRole("button", { name: "ほしいもの" });
await wantPanel.waitFor({ state: "attached" });
await wantPanel.evaluate((el) => el.click());
await page.getByText("グンゼのインナーシャツ").waitFor();
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(outDir, "want-yui.png") });
await page.getByText("れん", { exact: true }).last().click();
await page.getByText("フィルムカメラ").waitFor();
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(outDir, "want-ren.png") });
console.log(`差し替えた画像の要求: ${[...new Set(substituted)].join(", ")}`);
await browser.close();

// 058: 両モード（pink / white）で、月表示（天気の絵 + 祝日）・予定の詳細（天気の行）・マイページの地域の選択を撮る。
// ログイン状態は 045 の make-session.mjs の Cookie（shot-couple。今日に予定 1 件を置いてある）。
// 天気は wrangler dev が本物の気象庁から取る（固定の URL）。
//   node capture.mjs <baseURL> <outDir> <cookieFile>
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const [baseURL = "http://localhost:8081", outDir = "out", cookieFile = "session-cookie.txt"] = process.argv.slice(2);
const apiOrigin = "http://localhost:8787";
mkdirSync(outDir, { recursive: true });
const cookieValue = readFileSync(cookieFile, "utf8").trim();
const sessionCookie = { name: "better-auth.session_token", value: cookieValue, url: apiOrigin, httpOnly: true, sameSite: "Lax" };

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
}
async function shot(page, name) {
  await settle(page);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log("shot", name);
}
async function setAppearance(page, mode) {
  await page.evaluate((m) => {
    if (m === "pink") window.localStorage.removeItem("futary.appearance");
    else window.localStorage.setItem("futary.appearance", m);
  }, mode);
  await page.reload();
}

const record = { prompt: {}, weatherCells: {}, holidayCells: {}, rows: {}, area: {}, consoleErrors: [] };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await context.addCookies([sessionCookie]);
const page = await context.newPage();
page.setDefaultNavigationTimeout(180000);
page.on("console", (m) => {
  if (m.type() === "error") record.consoleErrors.push(m.text());
});
await page.goto(baseURL + "/", { timeout: 180000 });
await page.getByTestId("stats-card-days-number").waitFor({ timeout: 180000 });

for (const mode of ["pink", "white"]) {
  await page.goto(baseURL + "/");
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 60000 });
  await setAppearance(page, mode);
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 60000 });

  // 地域を外してから: 帯が出る
  await page.evaluate(() => window.localStorage.removeItem("futary.weatherPromptDismissed"));
  await page.goto(`${baseURL}/calendar`);
  await page.getByTestId("weather-prompt").waitFor({ timeout: 60000 }).catch(() => {});
  record.prompt[mode] = (await page.getByTestId("weather-prompt").count()) > 0;
  await shot(page, `${mode}-calendar-no-area`);

  // マイページで地域を選ぶ（東京都 → 東京地方）
  await page.goto(`${baseURL}/profile`);
  await page.getByTestId("profile-weather-area").waitFor({ timeout: 60000 });
  await page.getByTestId("profile-weather-area").scrollIntoViewIfNeeded();
  await page.getByTestId("profile-weather-area").click();
  await page.getByTestId("weather-area-sheet").waitFor({ timeout: 10000 });
  await shot(page, `${mode}-profile-area-prefectures`);
  await page.getByTestId("weather-pref-東京都").click();
  await page.getByTestId("weather-area-130010").waitFor({ timeout: 10000 });
  await shot(page, `${mode}-profile-area-tokyo`);
  await page.getByTestId("weather-area-130010").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="profile-weather-area"]')?.textContent?.includes("東京地方"), null, { timeout: 30000 });
  record.area[mode] = await page.getByTestId("profile-weather-area").textContent();
  await shot(page, `${mode}-profile-area-selected`);

  // 月表示: 天気の絵と祝日
  await page.goto(`${baseURL}/calendar`);
  await page.locator('[data-testid^="calendar-weather-"]').first().waitFor({ timeout: 60000 });
  record.weatherCells[mode] = await page.locator('[data-testid^="calendar-weather-"]').count();
  record.holidayCells[mode] = await page.locator('[data-testid^="calendar-holiday-"]').count();
  await shot(page, `${mode}-calendar-month`);

  // 予定の詳細（今日の予定がある）: 天気の行
  await page.getByTestId("calendar-weather-rows").waitFor({ timeout: 30000 });
  await page.getByTestId("calendar-weather-rows").scrollIntoViewIfNeeded();
  record.rows[mode] = await page.getByTestId("calendar-weather-rows").textContent();
  await shot(page, `${mode}-calendar-day-weather`);

  // 次に「未設定」に戻す（次の周回で帯を撮るため）
  await page.goto(`${baseURL}/profile`);
  await page.getByTestId("profile-weather-area").waitFor({ timeout: 60000 });
  await page.getByTestId("profile-weather-area").scrollIntoViewIfNeeded();
  await page.getByTestId("profile-weather-area").click();
  await page.getByTestId("weather-area-none").waitFor({ timeout: 10000 });
  await page.getByTestId("weather-area-none").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="profile-weather-area"]')?.textContent?.includes("未設定"), null, { timeout: 30000 });
}
await context.close();
await browser.close();
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));

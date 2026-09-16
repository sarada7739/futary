// 058 追補（予定の無い日にも天気の行）: 両モードで、7 日以内の予定の無い日（明日）を選び、
// 「この日の予定はありません」の下に天気の行が出るところを撮る。比べる用に今日（予定あり）も撮る。
// ログイン状態は 045 の make-session.mjs の Cookie（shot-couple）。地域は東京地方を選んでから撮る。
//   node capture-stage3.mjs <baseURL> <outDir> <cookieFile>
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

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const now = new Date();
const today = ymd(now);
const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

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
async function selectTokyo(page) {
  await page.goto(`${baseURL}/profile`);
  await page.getByTestId("profile-weather-area").waitFor({ timeout: 60000 });
  const text = await page.getByTestId("profile-weather-area").textContent();
  if (text?.includes("東京地方")) return;
  await page.getByTestId("profile-weather-area").scrollIntoViewIfNeeded();
  await page.getByTestId("profile-weather-area").click();
  await page.getByTestId("weather-area-sheet").waitFor({ timeout: 10000 });
  await page.getByTestId("weather-pref-東京都").click();
  await page.getByTestId("weather-area-130010").waitFor({ timeout: 10000 });
  await page.getByTestId("weather-area-130010").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="profile-weather-area"]')?.textContent?.includes("東京地方"), null, { timeout: 30000 });
}

const record = { today, tomorrow, withEvent: {}, noEvent: {}, noEventText: {}, consoleErrors: [] };
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
  await page.evaluate(() => window.localStorage.setItem("futary.weatherPromptDismissed", "1"));
  await selectTokyo(page);

  // 今日（予定あり）: 比べる用
  await page.goto(`${baseURL}/calendar`);
  await page.getByTestId("calendar-weather-rows").waitFor({ timeout: 60000 });
  await page.getByTestId("calendar-weather-rows").scrollIntoViewIfNeeded();
  record.withEvent[mode] = await page.getByTestId("calendar-weather-rows").textContent();
  await shot(page, `${mode}-day-with-event`);

  // 明日（予定なし）: 「この日の予定はありません」の下に天気の行
  await page.getByTestId(`calendar-day-${tomorrow}`).click();
  await page.getByText("この日の予定はありません").waitFor({ timeout: 30000 });
  await page.getByTestId("calendar-weather-rows").waitFor({ timeout: 30000 });
  await page.getByTestId("calendar-weather-rows").scrollIntoViewIfNeeded();
  record.noEvent[mode] = await page.getByTestId("calendar-weather-rows").textContent();
  // 「予定はありません」→ 天気の行、の順に並ぶこと（DOM の順で確かめる）
  record.noEventText[mode] = await page.evaluate(() => {
    const empty = [...document.querySelectorAll("*")].find((el) => el.childElementCount === 0 && el.textContent === "この日の予定はありません");
    const rows = document.querySelector('[data-testid="calendar-weather-rows"]');
    if (!empty || !rows) return "missing";
    return empty.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING ? "empty-then-weather" : "weather-then-empty";
  });
  await shot(page, `${mode}-day-no-event`);
}
await context.close();
await browser.close();
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));

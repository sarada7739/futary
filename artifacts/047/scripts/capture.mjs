// 047: 両モード（pink / white）× 猶予中・鍵の後で、アルバム一覧の帯・詳細の帯と鍵のマス・
// 鍵のマスを押したシート・マイページの帯を撮る。ログイン状態は 045 の make-session.mjs の Cookie。
//   node capture.mjs <baseURL> <outDir> <cookieFile> --state=grace|locked
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const [baseURL = "http://localhost:8081", outDir = "out", cookieFile = "session-cookie.txt"] = args.filter((a) => !a.startsWith("--"));
const state = args.find((a) => a.startsWith("--state="))?.slice("--state=".length) ?? "state";
const apiOrigin = "http://localhost:8787";
mkdirSync(outDir, { recursive: true });

const cookieValue = readFileSync(cookieFile, "utf8").trim();
const sessionCookie = { name: "better-auth.session_token", value: cookieValue, url: apiOrigin, httpOnly: true, sameSite: "Lax" };

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
}
async function shot(page, name) {
  await settle(page);
  await page.waitForFunction(() => [...document.images].every((img) => img.complete)).catch(() => {});
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("shot", file);
}
async function setAppearance(page, mode) {
  await page.evaluate((m) => {
    if (m === "pink") window.localStorage.removeItem("futary.appearance");
    else window.localStorage.setItem("futary.appearance", m);
  }, mode);
  await page.reload();
}
async function waitHome(page) {
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 60000 });
}
async function textOrNone(page, testId) {
  await page.waitForTimeout(500);
  const count = await page.getByTestId(testId).count();
  return count === 0 ? "(無し)" : await page.getByTestId(testId).first().textContent();
}

const record = { state, list: {}, detail: {}, profile: {}, lockedTiles: {}, photoUrls: {}, consoleErrors: [] };
const bandId = state === "locked" ? "lock-band-locked" : "lock-band-grace";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await context.addCookies([sessionCookie]);
const page = await context.newPage();
page.setDefaultNavigationTimeout(120000);
page.on("console", (m) => {
  if (m.type() === "error") record.consoleErrors.push(m.text());
});
// photo.list の応答で、鍵の写真に url が無いことを確かめる（確認観点「ネットワークの応答」）
page.on("response", async (res) => {
  if (!res.url().includes("/api/photo/list")) return;
  try {
    const body = await res.json();
    const items = body?.json?.items ?? body?.items ?? [];
    record.photoUrls[state] = { total: items.length, withUrl: items.filter((p) => typeof p.url === "string").length, locked: items.filter((p) => p.locked).length };
  } catch {}
});
// 最初の 1 回は Expo の bundle 待ち（30 秒超）
await page.goto(baseURL + "/", { timeout: 180000 });
await waitHome(page);

for (const mode of ["pink", "white"]) {
  await page.goto(baseURL + "/");
  await waitHome(page);
  await setAppearance(page, mode);
  await waitHome(page);

  // 一覧: 帯（使用量のカードの上）
  await page.goto(`${baseURL}/album`);
  await page.getByTestId("album-timeline-card").waitFor({ timeout: 60000 });
  await page.getByTestId(bandId).waitFor({ timeout: 60000 });
  await page.getByTestId(bandId).scrollIntoViewIfNeeded();
  record.list[mode] = await textOrNone(page, "lock-band-text");
  await shot(page, `${mode}-album-list-${state}`);

  // 詳細: 帯と（locked なら）鍵のマス
  await page.goto(`${baseURL}/album-detail?id=shot-album-trip`);
  await page.getByTestId("album-detail-period").waitFor({ timeout: 60000 });
  await page.getByTestId(bandId).waitFor({ timeout: 60000 });
  record.detail[mode] = await textOrNone(page, "lock-band-text");
  record.lockedTiles[mode] = await page.locator('[data-testid^="album-photo-locked-"]').count();
  await shot(page, `${mode}-album-detail-${state}`);
  if (state === "locked") {
    const firstLocked = page.locator('[data-testid^="album-photo-locked-"]').first();
    await firstLocked.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, `${mode}-album-detail-${state}-tiles`);
    // 鍵のマスの親（Pressable）を押す → 045 のシート
    await firstLocked.locator("xpath=..").click();
    await page.getByTestId("plan-limit-sheet").waitFor({ timeout: 10000 });
    await shot(page, `${mode}-album-detail-${state}-sheet`);
    await page.getByTestId("plan-limit-close").click();
    await page.getByTestId("plan-limit-sheet").waitFor({ state: "detached", timeout: 10000 });
  }

  // マイページ: 帯
  await page.goto(`${baseURL}/profile`);
  await page.getByTestId("profile-plan").waitFor({ timeout: 60000 });
  await page.getByTestId(bandId).waitFor({ timeout: 60000 });
  await page.getByTestId(bandId).scrollIntoViewIfNeeded();
  record.profile[mode] = await textOrNone(page, "lock-band-text");
  await page.waitForTimeout(300);
  await shot(page, `${mode}-profile-${state}`);
}
await context.close();
await browser.close();

writeFileSync(path.join(outDir, `capture-${state}.json`), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));

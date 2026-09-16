// 056: LP のスマホの枠の中のデモ。wrangler dev（apps/api/public = build:public の出力）に対して:
//  1280 幅: 節「さわってみる」が出て、框の中でデモ（ゲストの帯・ホーム）が動き、タブを切り替えられる。
//           帯の「ログイン」を押すと親ページが /app/ に移る（框の中でサインイン画面が出ない）
//  375 幅:  節が出ない（display: none）。iframe の読み込みが起きないこと（停止条件の確認）
//   node artifacts/056/scripts/capture.mjs http://localhost:8787 artifacts/056
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const [baseURL = "http://localhost:8787", outDir = "artifacts/056"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const record = { pc: {}, mobile: {}, consoleErrors: [] };

const browser = await chromium.launch();

// --- PC ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => {
    if (m.type() === "error") record.consoleErrors.push(m.text());
  });
  const appRequests = [];
  page.on("request", (r) => {
    if (r.url().includes("/app/")) appRequests.push(r.url());
  });
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  record.pc.demoVisible = await page.locator("#demo").isVisible();
  record.pc.appRequestedBeforeScroll = appRequests.length;
  await page.locator("#demo").scrollIntoViewIfNeeded();
  const frame = page.frameLocator("iframe.phone-screen");
  // ゲストの帯（デモ）とホームの統計カードが框の中に出る
  await frame.getByTestId("stats-card-days-number").waitFor({ timeout: 90000 });
  record.pc.frameDays = await frame.getByTestId("stats-card-days-number").textContent();
  record.pc.frameUrl = await page.evaluate(() => document.querySelector("iframe.phone-screen")?.contentWindow?.location.pathname + document.querySelector("iframe.phone-screen")?.contentWindow?.location.search);
  record.pc.signInShown = (await frame.getByText("ゲストではじめる").count()) > 0;
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, "pc-demo-home.png") });
  // 043 の「新機能のお知らせ」のシート（ゲストにも初回に出る）を閉じてから触る
  // 框は CSS の transform: scale(0.8) で縮めてあり、Playwright の座標クリックが框の中でずれる（Playwright の
  // 既知の制約。本物のブラウザの操作はずれない）ので、框の中は dispatchEvent("click") で押す
  const closeSheet = frame.getByLabel("閉じる");
  if ((await closeSheet.count()) > 0) {
    await closeSheet.first().dispatchEvent("click");
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: path.join(outDir, "pc-demo-home-closed.png") });
  // タブ切り替え（カレンダー）
  await frame.getByText("カレンダー").first().dispatchEvent("click");
  await page.waitForTimeout(1500);
  record.pc.afterTabUrl = await page.evaluate(() => document.querySelector("iframe.phone-screen")?.contentWindow?.location.pathname);
  await page.screenshot({ path: path.join(outDir, "pc-demo-calendar.png") });
  // 帯の「ログイン」→ 親ページが /app/ へ
  const login = frame.getByTestId("demo-banner-login");
  await login.first().dispatchEvent("click");
  await page.waitForURL((u) => u.pathname === "/app/" || u.pathname === "/app", { timeout: 30000 });
  record.pc.parentUrlAfterLogin = new URL(page.url()).pathname;
  await page.getByText("ゲストではじめる").waitFor({ timeout: 60000 }).catch(() => {});
  record.pc.parentShowsSignIn = (await page.getByText("ゲストではじめる").count()) > 0;
  await page.screenshot({ path: path.join(outDir, "pc-after-login-click.png") });
  await page.close();
}

// --- ログイン中のブラウザ（人間の指示: 框の中に実ユーザーのデータが写らない） ---
// 045 の make-session.mjs が作った shot-couple（付き合った日 2024-04-06）のセッション Cookie で LP を開く。
// 親ページ（/app/）は本人のペア、框の中はデモ（ゆい & れん）でなければならない
const cookieFile = process.argv[4];
if (cookieFile) {
  const { readFileSync } = await import("node:fs");
  const cookieValue = readFileSync(cookieFile, "utf8").trim();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "better-auth.session_token", value: cookieValue, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  const apiRequests = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) apiRequests.push({ url: new URL(r.url()).pathname, frame: r.frame() !== page.mainFrame(), cookie: r.headers().cookie ? "sent" : "none" });
  });
  // 親で本人のペアが出ること
  await page.goto(`${baseURL}/app/`, { waitUntil: "networkidle" });
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 90000 });
  record.loggedIn = { topDays: await page.getByTestId("stats-card-days-number").textContent() };
  record.loggedIn.topIsGuest = (await page.getByTestId("demo-banner-login").count()) > 0;
  // LP の框
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  await page.locator("#demo").scrollIntoViewIfNeeded();
  const frame = page.frameLocator("iframe.phone-screen");
  await frame.getByTestId("stats-card-days-number").waitFor({ timeout: 90000 });
  record.loggedIn.frameDays = await frame.getByTestId("stats-card-days-number").textContent();
  record.loggedIn.frameIsGuest = (await frame.getByTestId("demo-banner-login").count()) > 0;
  record.loggedIn.frameCoupleId = await page.evaluate(() => {
    const w = document.querySelector("iframe.phone-screen")?.contentWindow;
    return w ? w.location.pathname : null;
  });
  // 框の中からの API・認証の fetch に Cookie が付いていないこと
  record.loggedIn.frameApiRequests = apiRequests.filter((r) => r.frame);
  record.loggedIn.frameApiWithCookie = record.loggedIn.frameApiRequests.filter((r) => r.cookie === "sent").length;
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, "pc-logged-in-frame-is-demo.png") });
  await context.close();
}

// --- モバイル ---
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  const appRequests = [];
  page.on("request", (r) => {
    if (r.url().includes("/app/")) appRequests.push(r.url());
  });
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  record.mobile.demoVisible = await page.locator("#demo").isVisible();
  record.mobile.demoDisplay = await page.evaluate(() => getComputedStyle(document.querySelector("#demo")).display);
  // 下まで一度スクロールしても iframe を読みに行かないこと（display: none の lazy iframe）
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
  });
  await page.waitForTimeout(1500);
  record.mobile.appRequestsAfterScroll = appRequests;
  record.mobile.scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.screenshot({ path: path.join(outDir, "mobile-375-top.png") });
  await page.close();
}

await browser.close();
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));

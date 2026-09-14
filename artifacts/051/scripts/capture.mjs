// 051: ホーム（両モード）とサインイン・ランディングを撮る。
//   node capture.mjs <appURL> <landingURL> <outDir> <cookieFile>
// - ホームは 048 の make-session.mjs の Cookie でログイン状態。ランディングは apps/landing を静的に配信したもの
//   （python -m http.server。/assets と /style.css が index.html からの絶対パスなので apps/landing をルートに）
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const [appURL = "http://localhost:8081", landingURL = "http://localhost:8090", outDir = "out", cookieFile = "session-cookie.txt"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const cookieValue = readFileSync(cookieFile, "utf8").trim();
const record = { consoleErrors: [], home: {}, landing: {} };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await context.addCookies([{ name: "better-auth.session_token", value: cookieValue, url: "http://localhost:8787", httpOnly: true, sameSite: "Lax" }]);
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") record.consoleErrors.push(m.text());
});
async function shot(name) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForFunction(() => [...document.images].every((img) => img.complete)).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log("shot", name);
}

await page.goto(appURL + "/");
await page.getByTestId("stats-card-days-number").waitFor({ timeout: 90000 });
for (const mode of ["pink", "white"]) {
  await page.evaluate((m) => {
    if (m === "pink") window.localStorage.removeItem("futary.appearance");
    else window.localStorage.setItem("futary.appearance", m);
    // 「新機能のお知らせ」（3.0.0）は 1 枚目だけ撮り、ホームは既読にして撮る
    if (m === "white") window.localStorage.setItem("futary.releaseSeen", "3.0.0");
  }, mode);
  await page.reload();
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 90000 });
  const logo = await page.getByTestId("home-logo-image").boundingBox();
  record.home[mode] = { logo, hasTextLogo: (await page.getByTestId("home-logo-text").count()) > 0, title: await page.title() };
  await shot(mode === "pink" ? "pink-home-release-sheet" : `${mode}-home`);
  if (mode === "pink") {
    await page.evaluate(() => window.localStorage.setItem("futary.releaseSeen", "3.0.0"));
    await page.reload();
    await page.getByTestId("stats-card-days-number").waitFor({ timeout: 90000 });
    await shot("pink-home");
  }
}

// サインイン（ゲスト → ログアウト状態の画面はセッションが要らない）。別のコンテキストで Cookie 無し
const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const gpage = await guest.newPage();
await gpage.goto(appURL + "/sign-in");
await gpage.getByLabel("Nisoine").waitFor({ timeout: 60000 }).catch(() => {});
await gpage.waitForTimeout(800);
await gpage.screenshot({ path: path.join(outDir, "pink-sign-in.png") });
record.signIn = { title: await gpage.title(), logoLabel: await gpage.getByLabel("Nisoine").count() };
await guest.close();

// ランディング（端末幅と PC 幅）
await page.goto(landingURL + "/");
await page.waitForTimeout(800);
record.landing.title = await page.title();
record.landing.meta = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("meta[property^='og:'], meta[name^='twitter:'], meta[name='description']")].map((m) => [m.getAttribute("property") ?? m.getAttribute("name"), m.getAttribute("content")])));
record.landing.tagline = await page.locator(".tagline").textContent();
record.landing.footer = await page.locator("footer p").first().textContent();
record.landing.logoAlt = await page.locator("img.logo").getAttribute("alt");
await shot("landing-phone");
await page.setViewportSize({ width: 1280, height: 900 });
await shot("landing-pc");

await browser.close();
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2));
console.log("done", JSON.stringify({ ...record, consoleErrors: record.consoleErrors.length }));

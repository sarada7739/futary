// 045: 両モード（pink / white）× 端末幅・PC 幅で、アルバム一覧の「写真の使用量」のカード・詳細の
// 「27 / 30 枚」と警告のカード・上限のシート・/premium・マイページの「プラン」を撮る。
// ログイン状態は make-session.mjs が作った Cookie で再現する。
//   node capture.mjs <baseURL> <outDir> <cookieFile> --state=<label> [--sheet] [--paid]
//   --state: ファイル名の接尾辞（free26 / free30 / paid）
//   --sheet: FAB を押してシートを撮る（残り 0 の状態で使う）
//   --paid:  使用量のカード・枠の行・警告が無いことを確かめる
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const [baseURL = "http://localhost:8081", outDir = "out", cookieFile = "session-cookie.txt"] = args.filter((a) => !a.startsWith("--"));
const state = args.find((a) => a.startsWith("--state="))?.slice("--state=".length) ?? "state";
const withSheet = args.includes("--sheet");
const paid = args.includes("--paid");
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
  await page.waitForTimeout(800);
  const count = await page.getByTestId(testId).count();
  return count === 0 ? "(無し)" : await page.getByTestId(testId).first().textContent();
}

const record = { state, withSheet, paid, usage: {}, quota: {}, warning: {}, sheet: {}, premium: {}, plan: {}, consoleErrors: [] };

async function captureFor(browser, viewport, suffix) {
  const context = await browser.newContext(viewport);
  await context.addCookies([sessionCookie]);
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") record.consoleErrors.push(m.text());
  });
  await page.goto(baseURL + "/");
  await waitHome(page);

  for (const mode of ["pink", "white"]) {
    const key = `${mode}${suffix}`;
    // 前の周回はマイページで終わるので、外観を切り替える前にホームへ戻す（再読み込み先がホームになる）
    await page.goto(baseURL + "/");
    await waitHome(page);
    await setAppearance(page, mode);
    await waitHome(page);

    // 一覧: 使用量のカード
    await page.goto(`${baseURL}/album`);
    await page.getByTestId("album-timeline-card").waitFor({ timeout: 60000 });
    if (!paid) await page.getByTestId("album-usage-card").waitFor({ timeout: 60000 });
    record.usage[key] = {
      count: await textOrNone(page, "album-usage-count"),
      remaining: await textOrNone(page, "album-usage-remaining"),
    };
    await shot(page, `${mode}-album-list-${state}${suffix}`);

    // 詳細: 「27 / 30 枚」と警告
    await page.goto(`${baseURL}/album-detail?id=shot-album-trip`);
    await page.getByTestId("album-detail-period").waitFor({ timeout: 60000 });
    await page.getByTestId("album-detail-add").waitFor({ timeout: 60000 });
    if (!paid) await page.getByTestId("album-detail-quota").waitFor({ timeout: 60000 });
    record.quota[key] = await textOrNone(page, "album-detail-quota");
    record.warning[key] = await textOrNone(page, "album-quota-warning-title");
    await shot(page, `${mode}-album-detail-${state}${suffix}`);

    if (withSheet) {
      await page.getByTestId("album-detail-add").click();
      await page.getByTestId("plan-limit-sheet").waitFor({ timeout: 10000 });
      record.sheet[key] = {
        title: await page.getByTestId("plan-limit-title").textContent(),
        free: await page.getByTestId("plan-limit-free-line").textContent(),
        premium: await page.getByTestId("plan-limit-premium-line").textContent(),
      };
      await shot(page, `${mode}-album-plan-sheet-${state}${suffix}`);
      await page.getByTestId("plan-limit-close").click();
      await page.getByTestId("plan-limit-sheet").waitFor({ state: "detached", timeout: 10000 });
    }

    // /premium
    await page.goto(`${baseURL}/premium`);
    await page.getByTestId("premium-title").waitFor({ timeout: 60000 });
    record.premium[key] = {
      title: await page.getByTestId("premium-title").textContent(),
      comingSoon: await page.getByTestId("premium-coming-soon").textContent(),
      hasTrialWord: (await page.getByText(/トライアル/).count()) > 0,
    };
    await shot(page, `${mode}-premium-${state}${suffix}`);

    // マイページ: プラン
    await page.goto(`${baseURL}/profile`);
    await page.getByTestId("profile-plan").waitFor({ timeout: 60000 });
    await page.waitForFunction(() => (document.querySelector('[data-testid="profile-plan"]')?.textContent ?? "") !== "");
    record.plan[key] = {
      plan: await page.getByTestId("profile-plan").textContent(),
      premiumLink: await textOrNone(page, "profile-premium"),
    };
    await page.getByTestId("profile-plan").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, `${mode}-profile-${state}${suffix}`);
  }
  await context.close();
}

const browser = await chromium.launch();
await captureFor(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }, "");
await captureFor(browser, { viewport: { width: 1280, height: 900 } }, "-pc");
await browser.close();

writeFileSync(path.join(outDir, `capture-${state}.json`), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));

// 040 段階1: 両モード × ホーム（iPhone 幅・PC 幅）・ほしいもの一覧（相手タブ・自分タブ）・
// 追加モーダル・ゲストの見え方を撮る。ログイン状態は make-session.mjs が作った Cookie で再現する。
//   node capture.mjs <baseURL> <outDir> <cookieFile> [--live-url <URL>]
// --live-url を渡すと、ホワイトの自分のタブで実際にその URL を保存し、画像が付くかを撮る
// （ローカルの wrangler dev から外へ出るので、結果は PC の IP に依存する。本番の証明ではない）
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const [baseURL = "http://localhost:8081", outDir = "out", cookieFile = "session-cookie.txt"] = args;
const liveUrlIndex = args.indexOf("--live-url");
const liveUrl = liveUrlIndex >= 0 ? args[liveUrlIndex + 1] : null;
const apiOrigin = "http://localhost:8787";
mkdirSync(outDir, { recursive: true });

const cookieValue = readFileSync(cookieFile, "utf8").trim();
const sessionCookie = {
  name: "better-auth.session_token",
  value: cookieValue,
  url: apiOrigin,
  httpOnly: true,
  sameSite: "Lax",
};

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
}

async function shot(page, name) {
  await settle(page);
  // Expo の開発用フローティングボタン等（#root の外に描かれる）は隠す。ただし react-native-web の
  // Modal も #root の外（body 直下のポータル）に描かれるので、モーダルの中身を持つものは隠さない
  await page.evaluate(() => {
    for (const el of document.body.children) {
      if (el.id === "root") continue;
      if (el.querySelector('[role="dialog"], [aria-modal="true"], [data-testid^="want-form"]')) continue;
      el.style.visibility = "hidden";
    }
  });
  await page.waitForFunction(() => [...document.images].every((img) => img.complete)).catch(() => {});
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  await page.evaluate(() => {
    for (const el of document.body.children) el.style.visibility = "";
  });
  console.log("shot", file);
}

async function setAppearance(page, mode) {
  await page.evaluate((m) => {
    if (m === "pink") window.localStorage.removeItem("futary.appearance");
    else window.localStorage.setItem("futary.appearance", m);
  }, mode);
  await page.reload();
}

async function panel(page, label) {
  await page.getByRole("button", { name: label, exact: true }).first().click();
}

async function waitHome(page) {
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 30000 });
}

const errors = [];
const result = { baseURL, liveUrl, live: null };

const browser = await chromium.launch();

// ---- ログイン済み（iPhone 幅） ----
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await context.addCookies([sessionCookie]);
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(baseURL + "/");
  await waitHome(page);

  for (const mode of ["pink", "white"]) {
    await setAppearance(page, mode);
    await waitHome(page);
    await shot(page, `${mode}-home`);

    await panel(page, "ほしいもの");
    await page.getByRole("tab").first().waitFor({ timeout: 30000 });
    await page.getByText("ペアのマグカップ").waitFor({ timeout: 30000 });
    await shot(page, `${mode}-want-partner`);

    await page.getByRole("tab").nth(1).click();
    await page.getByLabel("ほしいものを追加").waitFor();
    await shot(page, `${mode}-want-me`);

    await page.getByLabel("ほしいものを追加").click();
    await page.getByTestId("want-form-url").waitFor();
    await page.getByTestId("want-form-url").fill("https://www.amazon.co.jp/dp/B0HJBHHXK2/");
    await page.getByTestId("want-form-note").fill("誕生日に");
    await shot(page, `${mode}-want-add`);

    if (mode === "white" && liveUrl) {
      // 実際に保存する。画像の取得（最大 12 秒）の間はボタンが「画像を取得中…」になる
      await page.getByTestId("want-form-url").fill(liveUrl);
      const started = Date.now();
      await page.getByText("保存", { exact: true }).click();
      const fetching = await page
        .getByText("画像を取得中…")
        .waitFor({ timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      await page.getByTestId("want-form-url").waitFor({ state: "detached", timeout: 30000 });
      const elapsedMs = Date.now() - started;
      await settle(page);
      const notice = await page
        .getByText("画像は取れませんでした。あとから付けられます")
        .isVisible()
        .catch(() => false);
      const images = await page.locator('[data-testid^="want-image-"]').count();
      result.live = { url: liveUrl, fetchingLabelShown: fetching, elapsedMs, noticeShown: notice, imageCards: images };
      await shot(page, "white-want-me-after-live-add");
    } else {
      await page.getByText("キャンセル", { exact: true }).click();
    }

    // ホームへ戻す（ボトムタブの「ホーム」）
    await page.getByText("ホーム", { exact: true }).last().click();
    await waitHome(page);
  }
  await context.close();
}

// ---- ログイン済み（PC 幅。ホームの 3 列が崩れないか） ----
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([sessionCookie]);
  const page = await context.newPage();
  await page.goto(baseURL + "/");
  await waitHome(page);
  for (const mode of ["pink", "white"]) {
    await setAppearance(page, mode);
    await waitHome(page);
    await shot(page, `${mode}-home-pc`);
    await panel(page, "ほしいもの");
    await page.getByText("ペアのマグカップ").waitFor({ timeout: 30000 });
    await shot(page, `${mode}-want-partner-pc`);
    await page.getByText("ホーム", { exact: true }).last().click();
    await waitHome(page);
  }
  await context.close();
}

// ---- ゲスト（Cookie 無し）: 2 人分のタブが見え、追加は無い ----
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(baseURL + "/");
  await page.getByText("ゲストではじめる").click();
  await waitHome(page);
  for (const mode of ["pink", "white"]) {
    await setAppearance(page, mode);
    await page.getByText("ゲストではじめる").waitFor().catch(() => {});
    if (await page.getByText("ゲストではじめる").isVisible().catch(() => false)) {
      await page.getByText("ゲストではじめる").click();
    }
    await waitHome(page);
    await panel(page, "ほしいもの");
    await page.getByRole("tab").first().waitFor({ timeout: 30000 });
    await settle(page);
    await shot(page, `${mode}-want-guest`);
    await page.getByRole("tab").nth(1).click();
    await page.getByText("追加はログインすると使えます").waitFor();
    await shot(page, `${mode}-want-guest-me-tab`);
    await page.getByText("ホーム", { exact: true }).last().click();
    await waitHome(page);
  }
  await context.close();
}

result.consoleErrors = errors;
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();

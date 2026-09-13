// 041 段階1: 両モード × ホーム・アルバム一覧・詳細・作成モーダル（カバー選択後）・アップロードの進捗・
// ビューアの保存ボタン・ゲストの見え方を撮る。ログイン状態は make-session.mjs が作った Cookie で再現する。
//   node capture.mjs <baseURL> <outDir> <cookieFile>
// 署名付き PUT（R2 へ直接）は page.route で受け止めて 200 を返す（本物の R2 に置かない。ローカルの
// wrangler dev の R2 とは別の実体なので、そのあとの addPhotos はローカルで INVALID_INPUT になる。
// 進捗の 1 行を撮るのが目的）。保存ボタンは photo.downloadUrl の応答（URL のクエリ）を記録する
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const assetsDir = path.join(repoRoot, "packages", "db", "seed", "assets");
const args = process.argv.slice(2);
const [baseURL = "http://localhost:8081", outDir = "out", cookieFile = "session-cookie.txt"] = args.filter((a) => !a.startsWith("--"));
// --guest-only: ゲストの部分だけ撮る（ログイン済みの部分を撮り直さない）
const guestOnly = args.includes("--guest-only");
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
  await page.evaluate(() => {
    for (const el of document.body.children) {
      if (el.id === "root") continue;
      if (el.querySelector('[role="dialog"], [aria-modal="true"], [data-testid^="album-form"], [data-testid^="image-viewer"]')) continue;
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

async function waitHome(page) {
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 60000 });
}

// ゲストに入る。ハイドレート前に押すと効かない（実測）ため、ホームが出るまで押し直す
async function enterGuest(page) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const button = page.getByText("ゲストではじめる");
    if (await button.isVisible().catch(() => false)) {
      await page.waitForTimeout(1500);
      await button.click().catch(() => {});
    }
    const ok = await page
      .getByTestId("stats-card-days-number")
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  throw new Error("ゲストでホームに入れなかった");
}

function writeResult() {
  writeFileSync(path.join(outDir, guestOnly ? "capture-guest.json" : "capture.json"), JSON.stringify(result, null, 2));
}

async function goHome(page) {
  await page.getByText("ホーム", { exact: true }).last().click();
  await waitHome(page);
}

// 署名付き PUT を受け止める（本物の R2 に置かない）。遅らせて進捗の 1 行を撮れるようにする
async function stubR2Put(context, delayMs) {
  await context.route(/r2\.cloudflarestorage\.com/, async (route) => {
    if (route.request().method() === "PUT") {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.fulfill({ status: 200, body: "" });
      return;
    }
    await route.continue();
  });
}

const errors = [];
const result = { baseURL, downloadUrlResponses: [], consoleErrors: errors };

const browser = await chromium.launch();

// ---- ログイン済み（iPhone 幅） ----
if (!guestOnly) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await context.addCookies([sessionCookie]);
  await stubR2Put(context, 1500);
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", async (res) => {
    if (res.url().includes("/api/photo/downloadUrl")) {
      try {
        const body = await res.json();
        const url = new URL(body.json.url);
        result.downloadUrlResponses.push({
          filename: body.json.filename,
          host: url.host,
          responseContentDisposition: url.searchParams.get("response-content-disposition"),
          expires: url.searchParams.get("X-Amz-Expires"),
        });
      } catch {
        result.downloadUrlResponses.push({ status: res.status() });
      }
    }
  });

  await page.goto(baseURL + "/");
  await waitHome(page);

  for (const mode of ["pink", "white"]) {
    await setAppearance(page, mode);
    await waitHome(page);
    await shot(page, `${mode}-home`);

    // 一覧
    await page.getByRole("button", { name: "アルバム", exact: true }).first().click();
    await page.getByTestId("album-card-shot-album-trip").waitFor({ timeout: 60000 });
    await shot(page, `${mode}-album-list`);

    // 作成モーダル（カバー選択後）
    await page.getByLabel("アルバムを作る").click();
    await page.getByTestId("album-form-cover").waitFor();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("album-form-cover").click()]);
    await chooser.setFiles(path.join(assetsDir, "meetup-4.jpg"));
    await page.getByTestId("album-form-cover-image").waitFor();
    await page.getByTestId("album-form-title").fill("沖縄・夏休み");
    await page.getByTestId("album-form-start").fill("20260701");
    await page.getByTestId("album-form-end").fill("20260703");
    await page.getByTestId("album-form-note").fill("初めての海");
    await shot(page, `${mode}-album-create`);
    await page.getByText("キャンセル", { exact: true }).click();

    // 詳細（京都旅行）
    await page.getByTestId("album-card-shot-album-trip").click();
    await page.getByTestId("album-detail-period").waitFor({ timeout: 60000 });
    await shot(page, `${mode}-album-detail`);

    // ビューア（保存ボタン・説明文）
    await page.getByTestId("album-photo-SHOTALBUMPHOTO00000000001").click();
    await page.getByTestId("image-viewer-download").waitFor();
    await shot(page, `${mode}-album-viewer`);
    // 保存を押す。<a download> はクロスオリジンではブラウザが遷移として扱い、本物の R2 は
    // Content-Disposition: attachment を返すので保存になる（段階0）が、ローカルは署名付き URL が
    // 本物の R2 を指し実体が無いため 404 のページに遷移する。応答（URL のクエリ）だけ記録して
    // アプリへ戻る
    await page.getByTestId("image-viewer-download").click();
    await page.waitForTimeout(2500);
    result.afterDownloadClickUrl = page.url();
    await page.goto(baseURL + "/");
    await waitHome(page);
    await page.getByRole("button", { name: "アルバム", exact: true }).first().click();
    await page.getByTestId("album-card-shot-album-trip").waitFor({ timeout: 60000 });
    await page.getByTestId("album-card-shot-album-trip").click();
    await page.getByTestId("album-detail-period").waitFor({ timeout: 60000 });

    // 選択モード（2 枚選ぶと「カバーにする」が押せない）
    await page.getByTestId("album-detail-select").click();
    await page.getByTestId("album-photo-SHOTALBUMPHOTO00000000001").click();
    await page.getByTestId("album-photo-SHOTALBUMPHOTO00000000002").click();
    await shot(page, `${mode}-album-select`);
    await page.getByTestId("album-detail-stop-selecting").click();

    // アップロードの進捗（PUT を 1.5 秒遅らせる）
    const [chooser2] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("album-detail-add").click()]);
    await chooser2.setFiles([
      path.join(assetsDir, "meetup-1.jpg"),
      path.join(assetsDir, "meetup-2.jpg"),
      path.join(assetsDir, "meetup-3.jpg"),
    ]);
    await page.getByTestId("album-detail-progress").waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(outDir, `${mode}-album-upload-progress.png`) });
    console.log("shot", `${mode}-album-upload-progress.png`, await page.getByTestId("album-detail-progress").textContent());
    await page.getByTestId("album-detail-progress").waitFor({ state: "detached", timeout: 60000 });
    await settle(page);

    // タイムライン（仮想）の詳細
    await page.getByTestId("album-detail-back").click();
    await page.getByTestId("album-timeline-card").waitFor();
    await page.getByTestId("album-timeline-card").click();
    await page.getByTestId("album-detail-summary").waitFor();
    await shot(page, `${mode}-album-timeline`);

    await goHome(page);
  }
  await context.close();
  writeResult();
}

// ---- ログイン済み（PC 幅） ----
if (!guestOnly) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([sessionCookie]);
  const page = await context.newPage();
  await page.goto(baseURL + "/");
  await waitHome(page);
  for (const mode of ["pink", "white"]) {
    await setAppearance(page, mode);
    await waitHome(page);
    await shot(page, `${mode}-home-pc`);
    await page.getByRole("button", { name: "アルバム", exact: true }).first().click();
    await page.getByTestId("album-card-shot-album-trip").waitFor({ timeout: 60000 });
    await shot(page, `${mode}-album-list-pc`);
    await goHome(page);
  }
  await context.close();
}

// ---- ゲスト（Cookie 無し）: デモペアのアルバム。+・⋯・編集・選択が無い ----
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(baseURL + "/");
  await enterGuest(page);
  for (const mode of ["pink", "white"]) {
    await setAppearance(page, mode);
    await enterGuest(page);
    await page.getByRole("button", { name: "アルバム", exact: true }).first().click();
    await page.getByTestId("album-timeline-card").waitFor({ timeout: 60000 });
    await shot(page, `${mode}-album-guest`);
    await page.getByTestId("album-card-demo-album-0").click();
    await page.getByTestId("album-detail-summary").waitFor();
    await shot(page, `${mode}-album-guest-detail`);
    await goHome(page);
  }
  await context.close();
}

writeResult();
console.log(JSON.stringify(result, null, 2));
await browser.close();

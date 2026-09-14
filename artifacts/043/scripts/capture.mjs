// 043: 両モード × ホームのボタン（NEW あり／なし）・「新機能のお知らせ」のシート・リリース履歴の一覧を撮る。
// ログイン状態は artifacts/041/scripts/make-session.mjs が作った Cookie で再現する（--guest で ゲスト）。
//   node capture.mjs <baseURL> <outDir> <cookieFile> [--guest]
// 「見た」は端末の localStorage なので、撮る前に消して未読から始める（sessionStorage の「後で」も消す）
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const [baseURL = "http://localhost:8081", outDir = "out", cookieFile = "session-cookie.txt"] = args.filter((a) => !a.startsWith("--"));
const guest = args.includes("--guest");
const apiOrigin = "http://localhost:8787";
mkdirSync(outDir, { recursive: true });

const SEEN_KEY = "futary.releaseSeen";
const LATER_KEY = "futary.releaseLater";

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
}

async function resetSeen(page) {
  await page.evaluate(
    ([seen, later]) => {
      window.localStorage.removeItem(seen);
      window.sessionStorage.removeItem(later);
    },
    [SEEN_KEY, LATER_KEY],
  );
}

async function readSeen(page) {
  return page.evaluate(
    ([seen, later]) => ({ seen: window.localStorage.getItem(seen), later: window.sessionStorage.getItem(later) }),
    [SEEN_KEY, LATER_KEY],
  );
}

async function waitHome(page) {
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 60000 });
}

// ホームのボタンは 3×3 の下（端末の幅では初期表示でタブバーの下に隠れる）。撮る前にそこまで送る
async function scrollToReleaseButton(page) {
  // scrollIntoViewIfNeeded では「見えている」判定がタブバー（absolute）を考慮せず、バーの下に隠れたまま
  // だった（ピンクの端末幅で実測）。ボタンを含むスクロール容器をいちばん下まで送る（paddingBottom の
  // TAB_BAR_CLEARANCE でバーの上に出る）
  await page.evaluate(() => {
    let node = document.querySelector('[data-testid="release-button"]');
    while (node && node.scrollHeight <= node.clientHeight + 1) node = node.parentElement;
    if (node) node.scrollTop = node.scrollHeight;
  });
  await page.waitForTimeout(400);
}

// ゲストに入る（041 の capture.mjs と同じ。ハイドレート前に押すと効かないため押し直す）
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

const record = {};

async function captureMode(context, mode, viewport, suffix) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(baseURL);
  if (guest) await enterGuest(page);
  else await waitHome(page);
  await setAppearance(page, mode);
  await resetSeen(page);
  await page.reload();
  if (guest) await enterGuest(page);
  else await waitHome(page);

  // 1. 未読で開くとシートが出る
  await page.getByTestId("release-sheet").waitFor({ timeout: 10000 });
  await shot(page, `${mode}-home-sheet${suffix}`);
  record[`${mode}${suffix}`] = { afterOpen: await readSeen(page) };

  // 2. 「後で通知する」→ 閉じるが未読のまま（NEW あり）
  await page.getByTestId("release-sheet-later").click();
  await page.getByTestId("release-sheet").waitFor({ state: "detached", timeout: 10000 });
  await page.getByTestId("release-button-new").waitFor({ timeout: 10000 });
  await scrollToReleaseButton(page);
  await shot(page, `${mode}-home-new${suffix}`);
  record[`${mode}${suffix}`].afterLater = await readSeen(page);

  // 3. ボタン → 一覧（開いた時点で既読）
  await page.getByTestId("release-button").click();
  await page.getByTestId("release-card-2.0.0").waitFor({ timeout: 10000 });
  await shot(page, `${mode}-releases${suffix}`);
  record[`${mode}${suffix}`].afterList = await readSeen(page);

  // 4. ‹ 戻る → ホーム。NEW が無く、シートも出ない
  await page.getByTestId("releases-back").click();
  await waitHome(page);
  await page.waitForTimeout(800);
  const newBadge = await page.getByTestId("release-button-new").count();
  const sheet = await page.getByTestId("release-sheet").count();
  record[`${mode}${suffix}`].afterBack = { newBadge, sheet, ...(await readSeen(page)) };
  await scrollToReleaseButton(page);
  await shot(page, `${mode}-home-seen${suffix}`);

  // 5. 開き直しても出ない（既読）
  await page.reload();
  if (guest) await enterGuest(page);
  else await waitHome(page);
  await page.waitForTimeout(800);
  record[`${mode}${suffix}`].afterReload = {
    newBadge: await page.getByTestId("release-button-new").count(),
    sheet: await page.getByTestId("release-sheet").count(),
  };

  await page.close();
}

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 2 });
if (!guest) {
  const cookieValue = readFileSync(cookieFile, "utf8").trim();
  await context.addCookies([{ name: "better-auth.session_token", value: cookieValue, url: apiOrigin, httpOnly: true, sameSite: "Lax" }]);
}

const phone = { width: 390, height: 844 };
const pc = { width: 1280, height: 900 };
for (const mode of ["pink", "white"]) {
  await captureMode(context, mode, phone, guest ? "-guest" : "");
  if (!guest) await captureMode(context, mode, pc, "-pc");
}

writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
await browser.close();

// 039 段階1: 両モード × 4画面のスクリーンショットと、ホワイトでピンクの色が
// computed style に残っていないかの走査。開発サーバ（expo web）に対して実行する。
//   node capture.mjs <baseURL> <outDir> [--pink-only]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const [baseURL = "http://localhost:8081", outDir = "out", ...flags] = process.argv.slice(2);
const pinkOnly = flags.includes("--pink-only");
mkdirSync(outDir, { recursive: true });

// ピンクの3色（タスク定義 確認観点）。react-native-web は rgb()/rgba() で書き出す
const PINK_RGB = [
  ["#F5868D", "245, 134, 141"],
  ["#7B4A3C", "123, 74, 60"],
  ["#FEF6F3", "254, 246, 243"],
];

async function scanPink(page) {
  return page.evaluate((pinks) => {
    const props = [
      "color",
      "backgroundColor",
      "borderTopColor",
      "borderRightColor",
      "borderBottomColor",
      "borderLeftColor",
      "boxShadow",
      "backgroundImage",
      "outlineColor",
      "textDecorationColor",
    ];
    const hits = [];
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      for (const p of props) {
        const v = cs[p];
        if (!v || v === "none") continue;
        for (const [hex, rgb] of pinks) {
          if (v.includes(rgb)) hits.push({ hex, prop: p, value: v, tag: el.tagName, testid: el.getAttribute("data-testid") });
        }
      }
    }
    return { elements: document.querySelectorAll("*").length, hits };
  }, PINK_RGB);
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
}

async function shot(page, name) {
  await settle(page);
  // Expo の開発用フローティングボタン等（#root の外に描かれる）は画素比較の
  // 対象外。両方（main の基準・このブランチ）で同じように隠す
  await page.evaluate(() => {
    for (const el of document.body.children) {
      if (el.id !== "root") el.style.visibility = "hidden";
    }
  });
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("shot", file);
}

async function enterGuest(page) {
  await page.goto(baseURL + "/");
  await page.getByText("ゲストではじめる").click();
  await page.getByTestId("stats-card-meetup-pill").waitFor({ timeout: 30000 });
}

async function tab(page, label) {
  // ボトムタブ（expo-router の Tabs は web で role=tab ではなく link/button になる
  // ことがあるため、テキストで最後の一致＝タブバー側を押す）
  await page.getByText(label, { exact: true }).last().click();
}

async function panel(page, label) {
  await page.getByRole("button", { name: label, exact: true }).first().click();
}

async function screensForMode(page, mode) {
  const scans = {};
  await shot(page, `${mode}-home`);
  scans.home = await scanPink(page);

  await panel(page, "タイムライン");
  await page.getByText("2026/").first().waitFor({ timeout: 30000 }).catch(() => {});
  await shot(page, `${mode}-timeline`);
  scans.timeline = await scanPink(page);

  await tab(page, "ホーム");
  await page.getByTestId("stats-card-meetup-pill").waitFor();
  await panel(page, "統計");
  await page.getByText("投稿数").waitFor({ timeout: 30000 });
  await shot(page, `${mode}-stats`);
  scans.stats = await scanPink(page);

  await tab(page, "マイページ");
  await page.getByText("マイページはログインすると使えます").waitFor();
  await shot(page, `${mode}-profile`);
  scans.profile = await scanPink(page);
  return scans;
}

async function otherScreensForScan(page) {
  const scans = {};
  await tab(page, "ホーム");
  await page.getByTestId("stats-card-meetup-pill").waitFor();
  for (const [key, label, marker] of [
    ["calendar", "カレンダー", "予定"],
    ["memory", "思い出", null],
    ["list", "リスト", null],
    ["mood", "気分の記録", null],
    ["ai-summary", "AIまとめ", null],
  ]) {
    await panel(page, label);
    if (marker) await page.getByText(marker).first().waitFor({ timeout: 30000 }).catch(() => {});
    await settle(page);
    await page.screenshot({ path: path.join(outDir, `white-scan-${key}.png`) });
    scans[key] = await scanPink(page);
    await tab(page, "ホーム");
    await page.getByTestId("stats-card-meetup-pill").waitFor();
  }
  return scans;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

const result = { baseURL, scans: {} };

// ---- ピンク（既定。localStorage 未設定） ----
await enterGuest(page);
result.storedBefore = await page.evaluate(() => localStorage.getItem("futary.appearance"));
result.scans.pink = await screensForMode(page, "pink");

if (!pinkOnly) {
  // ---- マイページで「ホワイト」を押す（保存ボタン無し。押した瞬間に変わる） ----
  await page.getByTestId("profile-appearance-white").click();
  await page.waitForTimeout(300);
  result.storedAfterSwitch = await page.evaluate(() => localStorage.getItem("futary.appearance"));
  result.themeColorAfterSwitch = await page.evaluate(
    () => document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null,
  );
  await shot(page, "white-profile-just-switched");

  // ---- リロードしてもホワイトのまま（サインイン画面から）----
  await page.reload();
  await page.getByText("ゲストではじめる").waitFor();
  await shot(page, "white-sign-in-after-reload");
  result.scans.whiteSignIn = await scanPink(page);
  await page.getByText("ゲストではじめる").click();
  await page.getByTestId("stats-card-meetup-pill").waitFor({ timeout: 30000 });
  result.scans.white = await screensForMode(page, "white");
  result.scans.whiteOthers = await otherScreensForScan(page);

  // ---- localStorage を消すとピンクに戻る ----
  await page.evaluate(() => localStorage.removeItem("futary.appearance"));
  await page.reload();
  await page.getByText("ゲストではじめる").waitFor();
  await shot(page, "pink-sign-in-after-clear");
  result.scans.pinkSignInAfterClear = await scanPink(page);
}

result.consoleErrors = errors;
writeFileSync(path.join(outDir, "scan.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(
  Object.fromEntries(
    Object.entries(result.scans).map(([k, v]) => [
      k,
      typeof v.hits === "undefined"
        ? Object.fromEntries(Object.entries(v).map(([s, r]) => [s, `${r.hits.length}/${r.elements}`]))
        : `${v.hits.length}/${v.elements}`,
    ]),
  ),
  null,
  2,
));
console.log("stored:", result.storedBefore, "->", result.storedAfterSwitch, "theme-color:", result.themeColorAfterSwitch);
console.log("console errors:", errors.length);
await browser.close();

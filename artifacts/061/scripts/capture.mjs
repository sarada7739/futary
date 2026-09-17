// 061: 下部タブバーを湾曲ガラスにする。
//
// 撮るもの（写真・投稿がタブバーの下を通る画面）:
//   ホーム（/）とカレンダー（/calendar）× ピンク／ホワイト
// 測るもの（capture.json）:
//   タブバーの矩形・FAB の矩形・tablist の子の数・role="tab" の数・ピルの矩形
//   → 「寸法は変えていない」「隠し画面が幅を食わない」の証明はこれでしか立たない
//
// 045 の make-session.mjs で作った Cookie を使う（058 の capture-stage3.mjs と同じ作法）。
//   node artifacts/061/scripts/capture.mjs <baseURL> <outDir> <cookieFile>
//   例: node artifacts/061/scripts/capture.mjs http://localhost:8081 artifacts/061 session-cookie.txt
//
// webkit も 1 枚撮れる（第4引数に webkit）。屈折の層（backdrop-filter: url()）が
// 捨てられる経路の見た目を残すため。入っていなければ飛ばす
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const playwright = require("@playwright/test");

const [
  baseURL = "http://localhost:8081",
  outDir = "artifacts/061",
  cookieFile = "session-cookie.txt",
  engineName = "chromium",
] = process.argv.slice(2);
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

const record = { engine: engineName, pink: {}, white: {}, consoleErrors: [] };

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
}

async function setAppearance(page, mode) {
  await page.evaluate((m) => {
    window.localStorage.setItem("futary.releaseSeen", "3.3.0");
    window.localStorage.setItem("futary.weatherPromptDismissed", "1");
    if (m === "pink") window.localStorage.removeItem("futary.appearance");
    else window.localStorage.setItem("futary.appearance", m);
  }, mode);
  await page.reload();
  await settle(page);
}

// タブバーまわりの実寸。数値で残せるものは全部ここで取る
function measureTabBar() {
  const round = (n) => Math.round(n * 10) / 10;
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) };
  };
  const bar = document.querySelector('[data-testid="glass-tab-bar"]');
  const tablist = document.querySelector('[role="tablist"]');
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const pill = document.querySelector('[data-testid="glass-pill"]');
  // FAB は tablist の中の role="none" の枠（＋投稿）。中の押せる要素の矩形を取る
  const fabSlot = tablist ? [...tablist.children].find((c) => ["none", "presentation"].includes(c.getAttribute("role"))) : null;
  const fab = fabSlot ? (fabSlot.querySelector("img") ?? fabSlot.querySelector("[tabindex]")) : null;
  const barRect = rect(bar);
  const fabRect = rect(fab);
  return {
    bar: barRect,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    // バーの下端から画面の下端まで（TAB_BAR_BOTTOM_MARGIN = 16 のはず）
    bottomMargin: barRect ? round(window.innerHeight - barRect.y - barRect.h) : null,
    tablistChildren: tablist ? tablist.children.length : null,
    tabCount: tabs.length,
    tabLabels: tabs.map((t) => t.textContent.trim()),
    selected: tabs.filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.textContent.trim()),
    pill: rect(pill),
    fab: fabRect,
    // FAB がバーの上端からどれだけはみ出しているか。旧実装は 12px。
    // R レビュー必須2 の回帰をここで数値に固定する
    fabOverhang: barRect && fabRect ? round(barRect.y - fabRect.y) : null,
    // ガラスの層が実際に出ているか（ホワイトは色収差の層を出さない）
    layers: {
      blur: !!document.querySelector('[data-testid="glass-blur"]'),
      sheet: !!document.querySelector('[data-testid="glass-sheet"]'),
      aberration: !!document.querySelector('[data-testid="glass-aberration"]'),
      rim: !!document.querySelector('[data-testid="glass-rim"]'),
    },
    // SVG フィルタの定義が文書にあるか（無いと filter: url() の参照が壊れる）
    filterDefs: ["nisoine-glass-pink", "nisoine-glass-white"].filter((id) => document.getElementById(id) !== null),
    supportsBackdropUrl:
      typeof CSS !== "undefined" && typeof CSS.supports === "function"
        ? CSS.supports("backdrop-filter", "url(#nisoine-glass-pink)")
        : null,
  };
}

const engine = playwright[engineName];
if (!engine) {
  console.error(`engine ${engineName} が無い`);
  process.exit(1);
}
const browser = await engine.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await context.addCookies([sessionCookie]);
const page = await context.newPage();
page.setDefaultNavigationTimeout(180000);
page.on("console", (m) => {
  if (m.type() === "error") record.consoleErrors.push(`${engineName}: ${m.text()}`);
});

await page.goto(`${baseURL}/`, { timeout: 180000 });
await page.getByTestId("glass-tab-bar").waitFor({ timeout: 180000 });

for (const mode of ["pink", "white"]) {
  await page.goto(`${baseURL}/`);
  await page.getByTestId("glass-tab-bar").waitFor({ timeout: 60000 });
  await setAppearance(page, mode);

  // ホーム。写真・カードがタブバーの下を通る
  await page.getByTestId("glass-tab-bar").waitFor({ timeout: 60000 });
  await settle(page);
  record[mode].home = await page.evaluate(measureTabBar);
  await page.screenshot({ path: path.join(outDir, `${engineName}-${mode}-home.png`) });
  // タブバーだけの寄り（ガラスの質感を見る）
  await page.getByTestId("glass-tab-bar").screenshot({ path: path.join(outDir, `${engineName}-${mode}-bar.png`) });

  // ホームを下までスクロールして、カードがバーの下に入った状態
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await settle(page);
  await page.screenshot({ path: path.join(outDir, `${engineName}-${mode}-home-scrolled.png`) });

  // カレンダー
  await page.goto(`${baseURL}/calendar`);
  await page.getByTestId("glass-tab-bar").waitFor({ timeout: 60000 });
  await settle(page);
  record[mode].calendar = await page.evaluate(measureTabBar);
  await page.screenshot({ path: path.join(outDir, `${engineName}-${mode}-calendar.png`) });
}

await browser.close();
writeFileSync(path.join(outDir, `capture${engineName === "chromium" ? "" : `-${engineName}`}.json`), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));

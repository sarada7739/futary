// 039: 本番相当の静的ビルド（wrangler dev が apps/api/public を配信）で、
// ホワイトを選んだ端末の起動時に「ピンクが一瞬見えるか」を測る。
//   node measure-flash.mjs <baseURL=http://localhost:8787/app/> <outDir>
//
// 測り方:
// - localStorage に futary.appearance=white を入れた状態でページを開く
// - addInitScript で requestAnimationFrame ごとに #root 直下の地の色を見て、
//   「ピンク(254,246,243)が最初に見えた時刻」「その後に白(255,255,255)になった時刻」を記録
// - Performance API の first-paint / first-contentful-paint も記録
// - 通信条件は「無制限（localhost）」と「4G相当」「低速3G相当」の3つ
// - 加えて、JS バンドルの応答を 1500ms 止めた状態のスクリーンショットを撮る
//   （JS が届くまでの間に利用者が見る画面そのもの）
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const [baseURL = "http://localhost:8787/app/", outDir = "out"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const INIT = `
  try { localStorage.setItem("futary.appearance", "white"); } catch {}
  window.__flash = { pinkSeen: null, whiteSeen: null, firstFrame: null, frames: 0 };
  // #root 配下のどれかの要素の地（background-color / background-image）に
  // ピンク(254,246,243)があるか。React Navigation の既定の地(242,242,242)など
  // 別の要素が先頭に来るため、最初の1要素ではなく全要素を見る
  function state() {
    const root = document.getElementById("root");
    if (!root || root.children.length === 0) return "empty";
    // +html.tsx の inline script が #root を visibility:hidden にしている間は
    // 画面に何も描かれない（白の空白）。computed の色ではなく可視性で判定する
    if (getComputedStyle(root).visibility === "hidden") { window.__flash.hiddenFrames = (window.__flash.hiddenFrames ?? 0) + 1; return "hidden"; }
    let pink = false;
    for (const el of root.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.backgroundColor.includes("254, 246, 243") || cs.backgroundImage.includes("254, 246, 243")) { pink = true; break; }
    }
    return pink ? "pink" : "not-pink";
  }
  function check() {
    const t = performance.now();
    const f = window.__flash;
    f.frames += 1;
    if (f.firstFrame === null) f.firstFrame = t;
    const s = state();
    if (f.attrAtFirstFrame === undefined) f.attrAtFirstFrame = document.documentElement.getAttribute("data-appearance");
    if (s === "pink" && f.pinkSeen === null) f.pinkSeen = t;
    if (s === "not-pink" && f.whiteSeen === null) f.whiteSeen = t;
    if (f.whiteSeen === null || f.frames < 5) requestAnimationFrame(check);
  }
  requestAnimationFrame(check);
`;

const CONDITIONS = [
  { name: "unthrottled", conditions: null },
  // Chrome DevTools のプリセット相当（bytes/sec）
  { name: "4g", conditions: { offline: false, latency: 20, downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8 } },
  { name: "slow3g", conditions: { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 } },
];

const browser = await chromium.launch();
const results = [];

for (const cond of CONDITIONS) {
  for (let run = 1; run <= 3; run++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (cond.conditions) {
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", cond.conditions);
    }
    await page.addInitScript(INIT);
    // 前回の visit と同じにするため、ブラウザキャッシュは context ごとに空
    await page.goto(baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => window.__flash.whiteSeen !== null || window.__flash.frames > 600, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(200);
    const data = await page.evaluate(() => {
      const paints = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]));
      const nav = performance.getEntriesByType("navigation")[0];
      return {
        ...window.__flash,
        paints,
        domContentLoaded: nav ? Math.round(nav.domContentLoadedEventStart) : null,
        loadEvent: nav ? Math.round(nav.loadEventStart) : null,
        finalPink: (() => {
          for (const el of document.querySelectorAll("#root *")) {
            const cs = getComputedStyle(el);
            if (cs.backgroundColor.includes("254, 246, 243") || cs.backgroundImage.includes("254, 246, 243")) return true;
          }
          return false;
        })(),
      };
    });
    const row = {
      condition: cond.name,
      run,
      firstPaint: data.paints["first-paint"] ?? null,
      firstContentfulPaint: data.paints["first-contentful-paint"] ?? null,
      pinkSeen: data.pinkSeen === null ? null : Math.round(data.pinkSeen),
      whiteSeen: data.whiteSeen === null ? null : Math.round(data.whiteSeen),
      pinkVisibleMs: data.pinkSeen !== null && data.whiteSeen !== null ? Math.round(data.whiteSeen - data.pinkSeen) : null,
      domContentLoaded: data.domContentLoaded,
      loadEvent: data.loadEvent,
      finalPink: data.finalPink,
      hiddenFrames: data.hiddenFrames ?? 0,
      attrAtFirstFrame: data.attrAtFirstFrame ?? null,
    };
    results.push(row);
    console.log(JSON.stringify(row));
    await context.close();
  }
}

// JS バンドルを 1500ms 止めて、その間に見える画面を撮る
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.addInitScript(INIT);
  await page.route("**/_expo/static/js/**", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const nav = page.goto(baseURL, { waitUntil: "load" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, "prerender-before-js-white-user.png") });
  await nav;
  await page.waitForFunction(() => window.__flash.whiteSeen !== null, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "prerender-after-js-white-user.png") });
  await context.close();
}

writeFileSync(path.join(outDir, "prerender-flash-measurement.json"), JSON.stringify({ baseURL, results }, null, 2));
await browser.close();

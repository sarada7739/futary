// 068 T4: LP の「さわってみる」の 3D を実ブラウザ（Playwright・Chromium）で確かめ、撮る。
//   node artifacts/068/scripts/capture.mjs <outDir> [baseURL=http://localhost:8787]
// 追補（人間のモデル）からの画面は artifacts/068/stage2/ に出す
// 先に `pnpm build:public` と api-dev（wrangler dev）。
// 傾けたまま押す: ふち（ステージの余白）をタッチで押さえて引いたまま（CDP の touchStart・touchMove）、
// マウスで iframe の中のタブを押す（pointerId が違うので傾きは動かない）。押したら touchEnd で離す
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const [outDir = "out", base = "http://localhost:8787"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const results = {};
const check = (name, ok, detail) => {
  results[name] = { ok, detail };
  console.log(`${ok ? "OK  " : "NG  "} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
};

const browser = await chromium.launch();

async function openDemo(contextOptions) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
  // デモの中の「新機能のお知らせ」と地域の案内が画面を覆わないように（同じオリジンの localStorage）
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("futary.releaseSeen", "9.9.9");
      window.localStorage.setItem("futary.weatherPromptDismissed", "1");
    } catch {
      // 無ければそのまま
    }
  });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.locator("#demo").scrollIntoViewIfNeeded();
  return { context, page };
}

const rectOf = (page) => page.locator(".phone .phone-screen").evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
const demoFrame = (page) => page.frames().find((f) => f.url().includes("/app/"));

// --- 1280 幅: 3D・傾ける・傾けたまま押す・戻る
{
  const { context, page } = await openDemo({ hasTouch: true });
  // 3D の本体を描く層（canvas）ができ、デモが読み終わるまで待つ
  await page.locator(".phone.is-3d canvas.phone3d-gl").waitFor({ timeout: 15000 });
  await page.waitForFunction(() => {
    const f = document.querySelector(".phone .phone-screen");
    return f?.contentDocument?.body?.innerText.includes("カレンダー");
  }, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const phone = page.locator(".phone");
  const box = await phone.boundingBox();
  const front = await rectOf(page);
  check("3D になる（canvas がある・2D の枠の絵は消える）", (await page.locator(".phone-frame").isHidden()) === true, front);
  await page.screenshot({ path: path.join(outDir, "front-1280.png"), clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 } });

  // ふち（ステージの左の余白）をタッチで押さえて右下へ引く
  const cdp = await context.newCDPSession(page);
  const sx = box.x + 30;
  const sy = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy, id: 1 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sx + 9 * i, y: sy + 4 * i, id: 1 }] });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  const tilted = await rectOf(page);
  check("ふちのドラッグで傾く（iframe の外接の矩形が正面と変わる）", tilted.w !== front.w || tilted.h !== front.h, { front, tilted });
  await page.screenshot({ path: path.join(outDir, "tilted-1280.png"), clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 } });

  // 傾けたまま、iframe の中のタブ「カレンダー」をマウスで押す
  const frame = demoFrame(page);
  const before = frame.url();
  await frame.getByRole("tab", { name: "カレンダー" }).click({ timeout: 10000 }).catch(async () => {
    await frame.getByText("カレンダー", { exact: true }).last().click({ timeout: 10000 });
  });
  await page.waitForTimeout(1200);
  const after = frame.url();
  const stillTilted = await rectOf(page);
  check("傾けたまま iframe の中のタブを押すとデモの画面が変わる", after !== before && after.includes("calendar"), { before, after });
  check("押している間も傾いたまま（マウスの操作で傾きが動かない）", stillTilted.w === tilted.w && stillTilted.h === tilted.h, stillTilted);
  await page.screenshot({ path: path.join(outDir, "tilted-tab-1280.png"), clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 } });

  // 離すと正面に戻る
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(1200);
  const back = await rectOf(page);
  check("離すと正面に戻る（約 0.6 秒）", Math.abs(back.w - front.w) <= 1 && Math.abs(back.h - front.h) <= 1, back);
  await page.screenshot({ path: path.join(outDir, "returned-1280.png"), clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 } });

  // マウスで右へ大きく引くと、上限（約 80°）まで傾く。裏面は見えない
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(sx + 30 * i, sy);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  const max = await rectOf(page);
  check("上限まで傾けると画面の幅が大きく縮む（約 80°。裏返らない）", max.w < front.w * 0.35 && max.w > 0, max);
  await page.screenshot({ path: path.join(outDir, "tilted-80-1280.png"), clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 } });
  await page.mouse.up();
  await page.waitForTimeout(1200);

  // タッチの縦のスワイプはページのスクロール（touch-action: pan-y）。傾きは変わらない
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy, id: 2 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sx, y: sy - 25 * i, id: 2 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(800);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  const afterSwipe = await rectOf(page);
  check("タッチの縦のスワイプはページがスクロールし、傾かない", scrollAfter > scrollBefore && Math.abs(afterSwipe.w - front.w) <= 1, { scrollBefore, scrollAfter, afterSwipe });
  await context.close();
}

// --- 767 幅: 節ごと出ない（056）
{
  const context = await browser.newContext({ viewport: { width: 767, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.waitForTimeout(1000);
  const demoVisible = await page.locator("#demo").isVisible();
  const canvases = await page.locator("canvas.phone3d-gl").count();
  check("767 幅では節が出ない・3D も組まない", demoVisible === false && canvases === 0, { demoVisible, canvases });
  await page.screenshot({ path: path.join(outDir, "phone-767.png"), fullPage: false });
  await context.close();
}

// --- prefers-reduced-motion: 2D のまま
{
  const { context, page } = await openDemo({ reducedMotion: "reduce" });
  await page.waitForTimeout(1500);
  const canvases = await page.locator("canvas.phone3d-gl").count();
  const is3d = await page.locator(".phone.is-3d").count();
  const frameVisible = await page.locator(".phone-frame").isVisible();
  check("prefers-reduced-motion では 2D の枠のまま", canvases === 0 && is3d === 0 && frameVisible, { canvases, is3d, frameVisible });
  const box = await page.locator(".phone").boundingBox();
  await page.screenshot({ path: path.join(outDir, "reduced-motion-1280.png"), clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 } });
  await context.close();
}

await browser.close();
writeFileSync(path.join(outDir, "capture-results.json"), JSON.stringify(results, null, 2));
const failed = Object.values(results).filter((r) => !r.ok).length;
console.log(`\n${Object.keys(results).length - failed} / ${Object.keys(results).length} OK`);
process.exit(failed === 0 ? 0 : 1);

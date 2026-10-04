// 068 追補 3: スクロールで斜めから正面へ、を実ブラウザ（Playwright・Chromium）で確かめ、撮る。
//   node artifacts/068/scripts/scroll-tilt.mjs <outDir> [baseURL=http://localhost:8787]
// 先に `pnpm build:public` と api-dev（wrangler dev）。ステージの上端をビューポートのいくつかの位置に置き、
// iframe の外接の矩形と変形（2D の matrix か 3D の matrix3d か）を見る。遠近がかかるので幅は傾きとそろって
// 変わらない。手前に来る角が大きく写るので、外接の矩形の高さが傾きの大きさとそろって増える
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

async function open(contextOptions = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
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
  // 節を一度見せて本体を読ませる
  await page.locator("#demo").scrollIntoViewIfNeeded();
  await page.locator(".phone.is-3d canvas.phone3d-gl").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  return { context, page };
}

// ステージの上端を、ビューポートの上から top px の位置に置く
async function placeStageTop(page, top) {
  await page.evaluate((t) => {
    const r = document.querySelector(".phone").getBoundingClientRect();
    window.scrollBy(0, r.top - t);
  }, top);
  await page.waitForTimeout(400);
  return page.locator(".phone .phone-screen").evaluate((el) => {
    const b = el.getBoundingClientRect();
    const stage = document.querySelector(".phone").getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), stageTop: Math.round(stage.top), transform: getComputedStyle(el).transform.slice(0, 9) };
  });
}

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
};

{
  const { context, page } = await open();
  const vh = 900;
  const h = await page.locator(".phone").evaluate((el) => el.getBoundingClientRect().height);
  const center = Math.round(vh / 2 - h / 2);
  const entering = await placeStageTop(page, 820);
  await shot(page, "entering-1280.png");
  const halfway = await placeStageTop(page, 600);
  await shot(page, "halfway-1280.png");
  const most = await placeStageTop(page, 300);
  await shot(page, "most-1280.png");
  const whole = await placeStageTop(page, vh - Math.round(h));
  await shot(page, "whole-1280.png");
  const atCenter = await placeStageTop(page, center);
  await shot(page, "center-1280.png");
  const past = await placeStageTop(page, center - 300);
  check("節が入ってきたところ（上端が下から 80px）では斜め（3D の変形）", entering.transform === "matrix3d(" && entering.h > atCenter.h + 10, { entering, atCenter });
  // easeInCubic: 見えている間ははっきり斜め（820px・600px はほぼ同じ）、中央に近づいてから正面へ
  const heights = [entering.h, halfway.h, most.h, whole.h, atCenter.h];
  check(
    "見えている間は斜めのまま、中央に近づいてから正面へ（高さが 820→600→300→全部→中心 で増えない。300px でもはっきり斜め）",
    heights.every((v, i) => i === 0 || v <= heights[i - 1] + 1) && most.h > atCenter.h + 8 && whole.transform === "matrix3d(",
    { heights, whole },
  );
  check("中心がビューポートの中心で正面（2D の変形・文字がにじまない）", atCenter.transform === "matrix(0." && atCenter.w === 312, atCenter);
  check("中心を過ぎても正面のまま", past.transform === "matrix(0." && past.w === 312, past);
  // 戻ると斜めに戻る（位置で決まる）
  const back = await placeStageTop(page, 820);
  check("上に戻ると同じ位置で同じ斜め", back.transform === "matrix3d(" && Math.abs(back.h - entering.h) <= 3, { entering: entering.h, back: back.h });

  // 斜めの位置でドラッグして離すと、その位置の斜めへ戻る
  const box = await page.locator(".phone").boundingBox();
  // 見えている上の帯（ステージの左の余白）を押して左へ引く
  const before = await page.locator(".phone .phone-screen").evaluate((el) => Math.round(el.getBoundingClientRect().height));
  await page.mouse.move(box.x + 30, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x - 170, box.y + 40, { steps: 6 });
  await page.waitForTimeout(200);
  const dragged = await page.locator(".phone .phone-screen").evaluate((el) => Math.round(el.getBoundingClientRect().height));
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const settled = await page.locator(".phone .phone-screen").evaluate((el) => ({ h: Math.round(el.getBoundingClientRect().height), transform: getComputedStyle(el).transform.slice(0, 9) }));
  check("ドラッグを離すと、正面ではなくスクロールの位置で決まる斜めへ戻る", dragged !== before && Math.abs(settled.h - before) <= 2 && settled.transform === "matrix3d(", { before, dragged, settled });
  await context.close();
}

{
  const { context, page } = await open({ reducedMotion: "reduce" });
  const entering = await placeStageTop(page, 820);
  check("動きを減らす設定では最初から正面（節の手前でも）", entering.transform === "matrix(0." && entering.w === 312, entering);
  await shot(page, "reduced-motion-entering-1280.png");
  await context.close();
}

await browser.close();
writeFileSync(path.join(outDir, "scroll-tilt-results.json"), JSON.stringify(results, null, 2));
const failed = Object.values(results).filter((r) => !r.ok).length;
console.log(`\n${Object.keys(results).length - failed} / ${Object.keys(results).length} OK`);
process.exit(failed === 0 ? 0 : 1);

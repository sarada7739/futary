// 068 追補 4 #5: iPhone を縦で開いてから横に回したときに 3D になるかを、Playwright で確かめて撮る。
//   node artifacts/068/scripts/orientation.mjs <outDir> [webkit|chromium=webkit] [baseURL=http://localhost:8787]
// Windows の Playwright の WebKit は CSS の 3D の変形（perspective）を描かない（iframe が本体の穴とずれて写る。
// stage5/report.md）。状態（.is-3d・層・読み直し）は WebKit で確かめ、見た目の画面は Chromium（同じ端末の設定）で撮る
// 先に `pnpm build:public` と api-dev（wrangler dev）。
// 回すのは画面の大きさを縦（iPhone 15 Pro Max）と横（同 landscape）で入れ替えて代える。
// 縦で開く → 横にする → 3D になり傾けられる → 縦に戻す（節が隠れる）→ 横にする → 3D のまま（組み直さない・iframe を読み直さない）
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const playwright = require("@playwright/test");
const { devices } = playwright;
const [outDir = "out", engine = "webkit", base = "http://localhost:8787"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const portrait = devices["iPhone 15 Pro Max"];
const landscape = devices["iPhone 15 Pro Max landscape"];
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "NG  "} ${name} ${JSON.stringify(detail)}`);
};

const browser = await playwright[engine].launch();
const context = await browser.newContext({ ...portrait });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// デモの iframe が読み直されていないかを、子の frame の移動の回数で数える
let iframeNavigations = 0;
page.on("framenavigated", (frame) => {
  if (frame !== page.mainFrame()) iframeNavigations += 1;
});

const state = () =>
  page.evaluate(() => {
    const phone = document.querySelector(".demo .phone");
    const iframe = document.querySelector(".demo .phone-screen");
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      demoShown: getComputedStyle(document.querySelector(".demo")).display !== "none",
      is3d: phone.classList.contains("is-3d"),
      cssLayers: document.querySelectorAll(".phone3d-css").length,
      canvases: document.querySelectorAll("canvas.phone3d-gl").length,
      iframeIn3d: Boolean(iframe.closest(".phone3d-css")),
      // 3D の変形（matrix3d）か、正面で止まっているときの 2D の変形か
      iframe3d: iframe.style.transform.includes("matrix3d"),
      iframeWidth: Math.round(iframe.getBoundingClientRect().width),
      // 電話の中心と画面の中心のずれ（0 なら正面になる位置）
      phoneCenterOffset: Math.round(phone.getBoundingClientRect().top + phone.getBoundingClientRect().height / 2 - window.innerHeight / 2),
    };
  });

// 電話の中心を画面の中心に置く（中心で正面になる。追補 3）
// WebKit は画面の大きさを変えた直後にスクロールの位置を自分で直すことがあるので、ずれが 2px 以内になるまで繰り返す
const centerPhone = async () => {
  for (let i = 0; i < 10; i += 1) {
    const offset = await page.evaluate(() => {
      const rect = document.querySelector(".demo .phone").getBoundingClientRect();
      const offset = rect.top + rect.height / 2 - window.innerHeight / 2;
      window.scrollBy(0, offset);
      return offset;
    });
    await page.waitForTimeout(800);
    if (Math.abs(offset) <= 2) return;
  }
};

const waitFor3d = async () => {
  await page.locator(".demo .phone.is-3d").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
};

// ふち（ステージの左の余白）をマウスで押さえて右へ引き、引いたまま撮る。離して正面に戻るのを待つ
const dragAndShoot = async (file) => {
  const box = await page.locator(".demo .phone").boundingBox();
  const viewport = page.viewportSize();
  const x = box.x + 40;
  const y = viewport.height / 2;
  const before = await state();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 6 });
  await page.mouse.move(x + 120, y, { steps: 6 });
  await page.waitForTimeout(300);
  const during = await state();
  const dragging = await page.locator(".demo .phone.is-dragging").count();
  await page.screenshot({ path: path.join(outDir, file) });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const after = await state();
  return { before, during, dragging, after };
};

// 1. 縦で開く: 節は隠れていて、3D は組まれていない（2D のまま）
await page.goto(`${base}/`);
await page.waitForTimeout(1500);
const s1 = await state();
check("縦で開く: 節が隠れ、3D は組まれていない", !s1.demoShown && !s1.is3d && s1.cssLayers === 0 && s1.canvases === 0, s1);
await page.screenshot({ path: path.join(outDir, `${engine}-orientation-1-portrait.png`) });

// 2. 横にする: 3D になり、傾けられる
await page.setViewportSize(landscape.viewport);
await centerPhone();
await waitFor3d();
await centerPhone();
const s2 = await state();
check("横にする: 3D になる（.is-3d・CSS3D の層 1・canvas 1・iframe は 3D の層）", s2.demoShown && s2.is3d && s2.cssLayers === 1 && s2.canvases === 1 && s2.iframeIn3d, s2);
await page.screenshot({ path: path.join(outDir, `${engine}-orientation-2-landscape.png`) });
const d2 = await dragAndShoot(`${engine}-orientation-2-landscape-tilted.png`);
check(
  "横: ふちをドラッグすると傾き（matrix3d・画面の幅が縮む）、離すと正面（2D の変形）に戻る",
  d2.dragging === 1 && d2.during.iframe3d && d2.during.iframeWidth < d2.before.iframeWidth - 10 && !d2.after.iframe3d,
  d2,
);
const navigationsBeforeRotate = iframeNavigations;

// 3. 縦に戻す: 節が隠れるだけで、3D は外さない
await page.setViewportSize(portrait.viewport);
await page.waitForTimeout(1000);
const s3 = await state();
check("縦に戻す: 節が隠れ、組んである 3D はそのまま（外さない）", !s3.demoShown && s3.is3d && s3.cssLayers === 1 && s3.canvases === 1 && s3.iframeIn3d, s3);
await page.screenshot({ path: path.join(outDir, `${engine}-orientation-3-portrait-again.png`) });

// 4. もう一度横にする: 組んである 3D がそのまま見える（組み直さない・iframe を読み直さない）・傾けられる
await page.setViewportSize(landscape.viewport);
await centerPhone();
const s4 = await state();
check(
  "もう一度横にする: 3D のまま（層・canvas は 1 つずつ・iframe を読み直さない）",
  s4.demoShown && s4.is3d && s4.cssLayers === 1 && s4.canvases === 1 && s4.iframeIn3d && iframeNavigations === navigationsBeforeRotate,
  { ...s4, iframeNavigations, navigationsBeforeRotate },
);
await page.screenshot({ path: path.join(outDir, `${engine}-orientation-4-landscape-again.png`) });
const d4 = await dragAndShoot(`${engine}-orientation-4-landscape-again-tilted.png`);
check(
  "もう一度横: ふちをドラッグすると傾き、離すと正面に戻る",
  d4.dragging === 1 && d4.during.iframe3d && d4.during.iframeWidth < d4.before.iframeWidth - 10 && !d4.after.iframe3d,
  d4,
);

check("ページのエラーが無い", errors.length === 0, errors);
await browser.close();
writeFileSync(path.join(outDir, `${engine}-orientation-results.json`), `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} / ${results.length} OK`);
process.exit(failed ? 1 : 0);

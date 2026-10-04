// 068: iPad・iPhone（iOS の Safari = WebKit）で 3D に切り替わるかを、Playwright の WebKit で確かめる。
//   node artifacts/068/scripts/ios-probe.mjs <outDir> [baseURL=http://localhost:8787]
// 端末の設定（画面の大きさ・タッチ・UA）は Playwright の devices を使う。コンソールのエラー・読み込みの失敗・
// 3D の状態（.is-3d・canvas・iframe の置き場所）を出す
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { webkit, devices } = require("@playwright/test");
const [outDir = "out", base = "http://localhost:8787"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await webkit.launch();
for (const [name, device] of [
  ["ipad-portrait", devices["iPad (gen 7)"]],
  ["iphone-landscape", devices["iPhone 13 landscape"]],
]) {
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  const logs = [];
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => logs.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(`${base}/`);
  const viewport = page.viewportSize();
  const demoVisible = await page.locator("#demo").isVisible();
  if (demoVisible) {
    await page.locator("#demo").scrollIntoViewIfNeeded();
    await page.waitForTimeout(6000);
  }
  const state = await page.evaluate(() => {
    const phone = document.querySelector(".phone");
    return {
      is3d: Boolean(phone?.classList.contains("is-3d")),
      canvas: Boolean(document.querySelector("canvas.phone3d-gl")),
      cssLayer: Boolean(document.querySelector(".phone3d-css")),
      iframeInCss3d: Boolean(document.querySelector(".phone3d-css .phone-screen")),
      minWidth768: window.matchMedia("(min-width: 768px)").matches,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      webgl2: Boolean(document.createElement("canvas").getContext("webgl2")),
      webgl: Boolean(document.createElement("canvas").getContext("webgl")),
      ua: navigator.userAgent,
    };
  });
  console.log(JSON.stringify({ name, viewport, demoVisible, state, logs }, null, 2));
  if (demoVisible) {
    const box = await page.locator(".phone").boundingBox();
    await page.screenshot({ path: path.join(outDir, `ios-${name}.png`), clip: { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 20), width: Math.min(box.width + 40, viewport.width), height: Math.min(box.height + 40, viewport.height) } });
  }
  await context.close();
}
await browser.close();

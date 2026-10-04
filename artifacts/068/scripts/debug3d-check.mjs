// 068: ?debug3d の表示を WebKit（iPad 相当）で確かめ、付けないときは何も出ないことを Chromium で確かめる。
//   node artifacts/068/scripts/debug3d-check.mjs <outDir>（先に pnpm build:public → api-dev）
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { webkit, chromium, devices } = require("@playwright/test");
const out = process.argv[2];
for (const [name, engine, opts, url] of [
  ["webkit-ipad-debug", webkit, devices["iPad (gen 7)"], "http://localhost:8787/?debug3d"],
  ["chromium-nodebug", chromium, { viewport: { width: 1280, height: 900 } }, "http://localhost:8787/"],
]) {
  const browser = await engine.launch();
  const page = await (await browser.newContext(opts)).newPage();
  await page.goto(url);
  await page.locator("#demo").scrollIntoViewIfNeeded();
  await page.waitForTimeout(5000);
  const text = await page.evaluate(() => [...document.querySelectorAll("pre")].map((p) => p.textContent).join("\n---\n"));
  console.log(`== ${name}\n${text || "(no debug box)"}`);
  await page.screenshot({ path: `${out}/${name}.png` });
  await browser.close();
}

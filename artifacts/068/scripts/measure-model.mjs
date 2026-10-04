// 068 追補: GLB の正面と背面を正射影で描いて PNG に書き、モデルの箱（min・max）を出す。
//   node artifacts/068/scripts/measure-model.mjs <phone.glb> <出力ディレクトリ> [pixelsPerUnit=2000]
// 画面の位置と大きさは、出した正面の絵の黒い縁の内側を python で測る（stage2/report.md）
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const here = path.dirname(fileURLToPath(import.meta.url));
const [glbFile, outDir, ppu = "2000"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const entry = buildSync({
  entryPoints: [path.join(here, "measure-entry.mjs")],
  bundle: true,
  format: "iife",
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({ content: entry });
const result = await page.evaluate(
  ([b, p]) => window.renderViews(b, p),
  [readFileSync(glbFile).toString("base64"), Number(ppu)],
);
for (const [name, dataUrl] of Object.entries(result.views)) {
  writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
}
console.log(JSON.stringify({ box: result.box, width: result.width, height: result.height, pixelsPerUnit: Number(ppu) }));
// 画面の中央・四隅の近く・島・縁（左右の端）の z
const points = [];
// 画面の上（島のまわり）を細かく: x −0.08〜0.08・y 0.92〜0.98
for (let x = -0.08; x <= 0.0801; x += 0.004) for (let y = 0.92; y <= 0.9801; y += 0.002) points.push([x, y]);
const hits = await page.evaluate(([b, p]) => window.raycastZ(b, p), [readFileSync(glbFile).toString("base64"), points]);
const zs = hits.filter((h) => h.z !== null).map((h) => h.z);
const top = [...hits].filter((h) => h.z !== null).sort((a, b) => b.z - a.z).slice(0, 5);
console.log(JSON.stringify({ count: zs.length, max: Math.max(...zs), min: Math.min(...zs), top }));
await browser.close();

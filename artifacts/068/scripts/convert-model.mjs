// 068 追補: 人間のモデル（FBX）を GLB にする。
//   node artifacts/068/scripts/convert-model.mjs inspect <model.fbx>
//   node artifacts/068/scripts/convert-model.mjs convert <model.fbx> <texture-1024.jpg> <出力.glb>
// FBXLoader・GLTFExporter は画像を扱うのに DOM が要るので、Playwright の Chromium の中で動かす。
// 面を減らすのはこの後の @gltf-transform/cli（手順は artifacts/068/stage2/report.md）
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const here = path.dirname(fileURLToPath(import.meta.url));

const [mode, fbxFile, textureFile, outFile] = process.argv.slice(2);
const entry = buildSync({
  entryPoints: [path.join(here, "convert-entry.mjs")],
  bundle: true,
  format: "iife",
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({ content: entry });
const fbxBase64 = readFileSync(fbxFile).toString("base64");
if (mode === "inspect") {
  console.log(JSON.stringify(await page.evaluate((b) => window.inspectFbx(b), fbxBase64), null, 2));
} else {
  const textureDataUrl = `data:image/jpeg;base64,${readFileSync(textureFile).toString("base64")}`;
  const glbBase64 = await page.evaluate(
    ([b, t]) => window.convertFbx(b, t, { metalness: 0.4, roughness: 0.4 }),
    [fbxBase64, textureDataUrl],
  );
  writeFileSync(outFile, Buffer.from(glbBase64, "base64"));
  console.log(`wrote ${outFile} ${Buffer.from(glbBase64, "base64").length} bytes`);
}
await browser.close();

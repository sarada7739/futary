// 039: ピンクが1ピクセルも変わっていないことを、main（基準）とこのブランチの
// スクリーンショットの画素比較で示す。
//   node pixel-diff.mjs <baselineDir> <candidateDir> <outJson> [names...]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { PNG } = createRequire(new URL("../../../node_modules/.pnpm/node_modules/", import.meta.url))("pngjs");

const [baselineDir, candidateDir, outJson, ...names] = process.argv.slice(2);
const targets = names.length > 0 ? names : ["pink-home", "pink-timeline", "pink-stats", "pink-profile"];

const results = [];
for (const name of targets) {
  const a = PNG.sync.read(readFileSync(path.join(baselineDir, `${name}.png`)));
  const b = PNG.sync.read(readFileSync(path.join(candidateDir, `${name}.png`)));
  const row = { name, baseline: `${a.width}x${a.height}`, candidate: `${b.width}x${b.height}`, differentPixels: null, maxChannelDiff: 0, total: a.width * a.height };
  if (a.width !== b.width || a.height !== b.height) {
    row.differentPixels = "size mismatch";
    results.push(row);
    continue;
  }
  let diff = 0;
  let maxD = 0;
  const bbox = { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 };
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      let d = 0;
      for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
      if (d > 0) {
        diff++;
        maxD = Math.max(maxD, d);
        bbox.minX = Math.min(bbox.minX, x);
        bbox.minY = Math.min(bbox.minY, y);
        bbox.maxX = Math.max(bbox.maxX, x);
        bbox.maxY = Math.max(bbox.maxY, y);
      }
    }
  }
  row.differentPixels = diff;
  row.maxChannelDiff = maxD;
  row.diffBox = diff > 0 ? bbox : null;
  results.push(row);
}
writeFileSync(outJson, JSON.stringify({ baselineDir, candidateDir, results }, null, 2));
console.table(results.map(({ name, differentPixels, total, maxChannelDiff, diffBox }) => ({ name, differentPixels, total, maxChannelDiff, diffBox: diffBox ? JSON.stringify(diffBox) : "" })));

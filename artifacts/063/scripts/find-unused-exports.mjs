// 063 #11: export されているのに、定義したファイルの外から一度も名前が出てこないものを挙げる。
// 名前の出現を文字列で数えるだけ（道具は入れない）。候補を出すまでで、消すかは人が grep で確かめる。
//   node artifacts/063/scripts/find-unused-exports.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const roots = [
  "apps/api/src",
  "apps/api/test",
  "apps/app/app",
  "apps/app/components",
  "apps/app/lib",
  "apps/app/test",
  "packages",
  "scripts",
  "e2e",
];
const exts = [".ts", ".tsx", ".mjs", ".mts", ".js"];

function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === "dist" || e === ".expo") continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

const files = roots.flatMap(walk);
const texts = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const decl = /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|function|type|interface|class|enum)\s+([A-Za-z_$][\w$]*)/gm;

const result = [];
for (const [file, text] of texts) {
  if (/[\\/](test|e2e)[\\/]/.test(file)) continue;
  for (const m of text.matchAll(decl)) {
    const name = m[1];
    const re = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`, "g");
    let outside = 0;
    for (const [other, otherText] of texts) {
      if (other === file) continue;
      if (re.test(otherText)) outside++;
      re.lastIndex = 0;
    }
    if (outside === 0) {
      const inside = (text.match(re) ?? []).length - 1;
      result.push({ file, name, usedInsideFile: inside });
    }
  }
}
for (const r of result) console.log(`${r.usedInsideFile > 0 ? "export-only" : "DEAD      "}  ${r.file}  ${r.name}  (inside: ${r.usedInsideFile})`);

// 063 T2: 指定した ref と作業ツリーで、コメントを除いたコードが同じかを確かめる。
// TypeScript のプリンタ（removeComments）で両方を出力し直して比べる。空行・改行位置・コメントの差は消える。
// 違うファイルだけを出す（消したコード・消したファイルはそのまま「違う」と出る）。
//   node artifacts/063/scripts/compare-code.mjs <base-ref> [パス…]
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const [base = "main", ...paths] = process.argv.slice(2);
const changed = execFileSync("git", ["diff", "--name-only", base, "--", ...paths], { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mts|mjs|js)$/.test(f));

const printer = ts.createPrinter({ removeComments: true });
function normalize(file, text) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") || file.endsWith(".mts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
  return printer.printFile(sf);
}

let same = 0;
const differ = [];
for (const file of changed) {
  const before = (() => {
    try {
      return execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch {
      return null;
    }
  })();
  const after = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (before === null || after === null) {
    differ.push(`${file}（${before === null ? "新規" : "削除"}）`);
    continue;
  }
  if (normalize(file, before) === normalize(file, after)) same++;
  else differ.push(file);
}
console.log(`コメント以外が同じ: ${same} ファイル`);
console.log(`コードが違う: ${differ.length} ファイル`);
for (const f of differ) console.log(`  ${f}`);

// 063 T2（LP）: HTML・CSS の前後で、コメントを除いて空白を詰めた中身が同じかを確かめる。
// コメントの除き方は本番のビルドと同じ（scripts/build-public.mjs の stripHtmlComments・stripCssComments）。
//   node artifacts/063/scripts/compare-landing.mjs <base-ref>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { stripCssComments, stripHtmlComments } from "../../../scripts/build-public.mjs";

const [base = "main"] = process.argv.slice(2);
const files = ["index.html", "privacy.html", "terms.html", "tokushoho.html", "tech.html", "style.css"].map((f) => `apps/landing/${f}`);
const squash = (t) => t.replace(/\s+/g, " ").trim();
let same = 0;
const differ = [];
for (const file of files) {
  const before = execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" });
  const after = readFileSync(file, "utf8");
  const strip = file.endsWith(".css") ? stripCssComments : stripHtmlComments;
  if (squash(strip(before)) === squash(strip(after))) same++;
  else differ.push(file);
}
console.log(`コメント以外が同じ: ${same} ファイル`);
console.log(`違う: ${differ.length} ファイル`);
for (const f of differ) console.log(`  ${f}`);

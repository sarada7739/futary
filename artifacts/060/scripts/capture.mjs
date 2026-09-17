// 060: wrangler dev（apps/api/public = build:public の出力）で `/`・`/privacy`・`/tech` が今まで通り表示されることと、
// 配信される HTML・CSS にコメントが無いことを記録する。
//   node artifacts/060/scripts/capture.mjs http://localhost:8787 artifacts/060
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const [baseURL = "http://localhost:8787", outDir = "artifacts/060"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const record = { served: {}, pages: {}, consoleErrors: [] };

// 配信される本文のコメントの数（curl 相当）
for (const p of ["/", "/privacy", "/terms", "/tokushoho", "/tech", "/style.css"]) {
  const res = await fetch(baseURL + p);
  const body = await res.text();
  record.served[p] = {
    status: res.status,
    bytes: body.length,
    htmlComments: (body.match(/<!--/g) ?? []).length,
    cssComments: (body.match(/\/\*/g) ?? []).length,
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error") record.consoleErrors.push(m.text());
});
for (const [p, name] of [
  ["/", "index"],
  ["/privacy", "privacy"],
  ["/tech", "tech"],
]) {
  await page.goto(baseURL + p, { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  record.pages[p] = {
    title: await page.title(),
    h1: await page.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? null),
    sections: await page.evaluate(() => document.querySelectorAll("section").length),
    // CSS が効いている（コメントを落としても壊れていない）: body の文字色と .container の幅
    bodyColor: await page.evaluate(() => getComputedStyle(document.body).color),
    containerMaxWidth: await page.evaluate(() => {
      const c = document.querySelector(".container");
      return c ? getComputedStyle(c).maxWidth : null;
    }),
  };
  await page.screenshot({ path: path.join(outDir, `pc-${name}.png`), fullPage: p !== "/" });
}
await browser.close();
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2), "utf8");
console.log(JSON.stringify(record, null, 2));

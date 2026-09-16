// 059: LP の「さわってみる」を 2 列に・AI まとめの帯の写真を外す・写真カードの余白。wrangler dev（apps/api/public）に対して:
//  1280 幅: 節「さわってみる」でスマホが左・右に見出し + 説明 + 案内 + ボタン（上下中央）。帯に写真が無い。
//           節 3・6・7 の写真カードで写真の下に余白（img の下端とカードの下端の差 = 22px + 枠線）
//  800 幅:  右の列が折り返して収まる（横スクロールが出ない）
//  375 幅:  節が出ない（display: none。今まで通り）
//   node artifacts/059/scripts/capture.mjs http://localhost:8787 artifacts/059
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const [baseURL = "http://localhost:8787", outDir = "artifacts/059"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const record = { pc: {}, w800: {}, mobile: {}, consoleErrors: [] };

const browser = await chromium.launch();

async function open(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("console", (m) => {
    if (m.type() === "error") record.consoleErrors.push(`${width}: ${m.text()}`);
  });
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}

function measureDemo() {
  const inner = document.querySelector(".demo-inner");
  const phone = document.querySelector(".demo .phone");
  const copy = document.querySelector(".demo-copy");
  const h2 = document.querySelector("#demo-heading");
  const btn = document.querySelector(".demo-copy .btn-primary");
  if (!inner || !phone || !copy || !h2 || !btn) return { visible: false };
  const r = (el) => el.getBoundingClientRect();
  const ri = r(inner);
  const rp = r(phone);
  const rc = r(copy);
  return {
    visible: getComputedStyle(inner.closest(".demo")).display !== "none",
    gridColumns: getComputedStyle(inner).gridTemplateColumns,
    phoneLeft: Math.round(rp.left - ri.left),
    phoneWidth: Math.round(rp.width),
    copyLeft: Math.round(rc.left - ri.left),
    copyWidth: Math.round(rc.width),
    copyRightOfPhone: rc.left >= rp.right,
    // 右の列が上下中央: 列の上下の余白の差（|上 - 下|）
    copyCenterOffset: Math.round(Math.abs(rc.top - ri.top - (ri.bottom - rc.bottom))),
    h2TextAlign: getComputedStyle(h2).textAlign,
    guideItems: document.querySelectorAll(".demo-guide li").length,
    buttonText: btn.textContent.trim(),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  };
}

function measureCards() {
  return [...document.querySelectorAll(".photo-card")].map((card) => {
    const img = card.querySelector("img");
    const rc = card.getBoundingClientRect();
    const ri = img.getBoundingClientRect();
    return {
      bottomGap: Math.round(rc.bottom - ri.bottom),
      sideGap: Math.round(ri.left - rc.left),
      radius: getComputedStyle(img).borderRadius,
    };
  });
}

// --- 1280 ---
{
  const page = await open(1280, 900);
  record.pc.demo = await page.evaluate(measureDemo);
  record.pc.aiBandPhotos = await page.evaluate(() => document.querySelectorAll(".ai-band img:not(.ai-band-bg)").length);
  record.pc.aiBandHeight = await page.evaluate(() => Math.round(document.querySelector(".ai-band").getBoundingClientRect().height));
  record.pc.cards = await page.evaluate(measureCards);
  await page.locator("#demo").scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500); // iframe の中のデモが描かれるのを待つ
  await page.locator("#demo").screenshot({ path: path.join(outDir, "pc-demo.png") });
  await page.locator("section.ai").screenshot({ path: path.join(outDir, "pc-ai-band.png") });
  await page.locator(".cards-3").screenshot({ path: path.join(outDir, "pc-cards-3.png") });
  await page.locator(".cards-2").first().screenshot({ path: path.join(outDir, "pc-cards-2.png") });
  await page.screenshot({ path: path.join(outDir, "pc-full.png"), fullPage: true });
  await page.close();
}

// --- 800 ---
{
  const page = await open(800, 900);
  record.w800.demo = await page.evaluate(measureDemo);
  await page.locator("#demo").scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  await page.locator("#demo").screenshot({ path: path.join(outDir, "w800-demo.png") });
  await page.close();
}

// --- 375 ---
{
  const page = await open(375, 812);
  record.mobile.demoDisplay = await page.evaluate(() => getComputedStyle(document.querySelector(".demo")).display);
  record.mobile.scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  record.mobile.aiBandPhotos = await page.evaluate(() => document.querySelectorAll(".ai-band img:not(.ai-band-bg)").length);
  record.mobile.cards = await page.evaluate(measureCards);
  await page.locator("section.ai").scrollIntoViewIfNeeded();
  await page.locator("section.ai").screenshot({ path: path.join(outDir, "mobile-375-ai-band.png") });
  await page.locator(".cards-3").screenshot({ path: path.join(outDir, "mobile-375-cards-3.png") });
  await page.close();
}

await browser.close();
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));

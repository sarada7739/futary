// 050: 390pt 幅（iPhone）でタイムラインの各投稿カードの高さを実測し（T5）、両モードで撮る。
//   node capture.mjs <baseURL> <outDir> <cookieFile>
// - ログイン状態は artifacts/048/scripts/make-session.mjs の Cookie。投稿は make-posts.mjs（4 枚 / 横長 / 縦長 / 文字 1 行）
// - 署名付き URL は本物の R2 を指すので、GET を route で受け止めて packages/db/seed/assets の JPEG を返す
//   （key の数字 1 = 縦長 meetup-1、2〜4 = 横長）
// - 高さは data-testid="post-card" の getBoundingClientRect。カードの間（gap）も測る
// - 「X の 1 ポストと並べた 1 枚」: 文字 1 行のカードの横に高さ 100pt の物差し（X の 1 ポスト ≈ 100pt）を重ねて撮る
//   （人間の X の画面写真はリポジトリに無いので、A の定義の数字〈約 100pt〉を物差しにした）
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

const args = process.argv.slice(2);
const [baseURL = "http://localhost:8081", outDir = "out", cookieFile = "session-cookie.txt"] = args.filter((a) => !a.startsWith("--"));
const apiOrigin = "http://localhost:8787";
mkdirSync(outDir, { recursive: true });
const cookieValue = readFileSync(cookieFile, "utf8").trim();
const sessionCookie = { name: "better-auth.session_token", value: cookieValue, url: apiOrigin, httpOnly: true, sameSite: "Lax" };
const assetsDir = path.join(repoRoot, "packages", "db", "seed", "assets");
const portrait = readFileSync(path.join(assetsDir, "meetup-1.jpg"));
const landscape = readFileSync(path.join(assetsDir, "meetup-2.jpg"));

const record = { viewport: { width: 390, height: 844 }, consoleErrors: [], modes: {} };

async function shot(page, name, options = {}) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForFunction(() => [...document.images].every((img) => img.complete)).catch(() => {});
  await page.waitForTimeout(400);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, ...options });
  console.log("shot", file);
}
async function setAppearance(page, mode) {
  await page.evaluate((m) => {
    if (m === "pink") window.localStorage.removeItem("futary.appearance");
    else window.localStorage.setItem("futary.appearance", m);
  }, mode);
  await page.reload();
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: record.viewport, deviceScaleFactor: 2 });
await context.addCookies([sessionCookie]);
await context.route(/r2\.cloudflarestorage\.com/, async (route) => {
  const m = /(\d)P\d\.jpg/.exec(new URL(route.request().url()).pathname);
  const body = m && m[1] === "1" ? portrait : landscape;
  await route.fulfill({ status: 200, contentType: "image/jpeg", body, headers: { "access-control-allow-origin": "*" } });
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") record.consoleErrors.push(m.text());
});
await page.goto(baseURL + "/");
await page.getByTestId("stats-card-days-number").waitFor({ timeout: 90000 });

for (const mode of ["pink", "white"]) {
  await page.goto(baseURL + "/");
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 90000 });
  await setAppearance(page, mode);
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 90000 });
  await page.goto(`${baseURL}/timeline`);
  await page.getByTestId("post-card").first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="post-card"]').length >= 4, null, { timeout: 60000 });
  await page.waitForFunction(() => [...document.images].every((img) => img.complete)).catch(() => {});
  await page.waitForTimeout(600);

  // 各カードの高さ（上から: 4 枚 / 横長 / 縦長 / 文字 1 行）と、カードの間
  const measured = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="post-card"]')].map((el) => {
      const r = el.getBoundingClientRect();
      const body = el.querySelector('[data-testid="post-card-header-line"]')?.parentElement?.textContent ?? "";
      const heart = el.querySelector('[data-testid="post-card-reaction-heart"]');
      const hr = heart ? heart.getBoundingClientRect() : null;
      const single = el.querySelector('[data-testid^="post-images-single-"]');
      const img = single ? single.querySelector("img, [style*='aspect-ratio'], div[style*='background-image']") : null;
      const ir = img ? img.getBoundingClientRect() : null;
      return {
        text: body.slice(0, 30),
        top: Math.round(r.top * 10) / 10,
        height: Math.round(r.height * 10) / 10,
        heartHeight: hr ? Math.round(hr.height * 10) / 10 : null,
        single: single ? single.getAttribute("data-testid") : null,
        image: ir ? { width: Math.round(ir.width), height: Math.round(ir.height), left: Math.round(ir.left - r.left) } : null,
      };
    });
    const gaps = cards.slice(1).map((c, i) => Math.round((c.top - (cards[i].top + cards[i].height)) * 10) / 10);
    const heart = document.querySelector('[data-testid="post-card-reaction-heart"]');
    const heartStyle = heart ? getComputedStyle(heart) : null;
    return {
      cards,
      gaps,
      heartPadding: heartStyle ? `${heartStyle.paddingTop} / ${heartStyle.paddingBottom}` : null,
      heartMargin: heartStyle ? `${heartStyle.marginTop} / ${heartStyle.marginBottom}` : null,
    };
  });
  record.modes[mode] = measured;
  console.log(mode, JSON.stringify(measured));

  await shot(page, `${mode}-timeline`);
  await shot(page, `${mode}-timeline-full`, { fullPage: true });

  // 文字 1 行のカード（一番下）を画面に出し、横に 100pt の物差しを重ねて撮る（X の 1 ポスト ≈ 100pt）
  const textCard = page.getByTestId("post-card").nth(3);
  await textCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="post-card"]')][3];
    const r = el.getBoundingClientRect();
    const ruler = document.createElement("div");
    ruler.id = "x-ruler";
    ruler.style.cssText = `position:fixed;left:${r.left - 14}px;top:${r.top - 4}px;width:6px;height:108px;background:#1d9bf0;border-radius:3px;z-index:9999;`;
    const label = document.createElement("div");
    label.style.cssText = `position:fixed;left:${r.left - 14}px;top:${r.top - 20}px;font:11px sans-serif;color:#1d9bf0;z-index:9999;white-space:nowrap;`;
    label.textContent = `X の 1 ポスト ≈ 100pt + 間 8（青）/ futary ${Math.round(r.height)}pt + 間 8`;
    document.body.append(ruler, label);
  });
  await page.waitForTimeout(200);
  const r = await textCard.boundingBox();
  await page.screenshot({ path: path.join(outDir, `${mode}-one-line-vs-x.png`), clip: { x: 0, y: Math.max(0, r.y - 28), width: 390, height: 150 } });
  await page.evaluate(() => document.getElementById("x-ruler")?.remove());
}

await browser.close();
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2));
console.log("done. consoleErrors:", record.consoleErrors.length);

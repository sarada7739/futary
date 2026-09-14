// 049: 本物のバンドル（expo web）で + → 45 枚を選ぶ → 確認のシート → 送る → 進捗と「やめる」→ 「N 枚まで入りました」を撮る。
//   node capture.mjs <baseURL> <outDir> <cookieFile>
// - ログイン状態は artifacts/048/scripts/make-session.mjs が作った Cookie（ペア zip-couple・アルバム zip-album-kyoto）
// - 署名付き PUT は本物の R2 を指すので route で 200 を返す（本番のバケットに置かない）。ローカルの addPhotos は
//   実体をローカル R2 に見つけられず INVALID_INPUT を返す → 塊は入らない。ここで見るのは画面の経路
//   （確認 → 20 枚ずつ → やめる → 文言）。実際に入るかは人間の実機（本番）で
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
const asset = path.join(repoRoot, "packages", "db", "seed", "assets", "meetup-2.jpg");
const record = { consoleErrors: [], putRequests: 0, addPhotosRequests: 0, confirmText: null, progressTexts: [], noticeText: null };

async function shot(page, name) {
  await page.waitForTimeout(400);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("shot", file);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await context.addCookies([sessionCookie]);
// 署名付き PUT を受け止める（本物の R2 に置かない）。PUT を少し遅らせて進捗と「やめる」を撮れるようにする
await context.route(/r2\.cloudflarestorage\.com/, async (route) => {
  if (route.request().method() === "PUT") {
    record.putRequests += 1;
    await new Promise((r) => setTimeout(r, 150));
    await route.fulfill({ status: 200, body: "", headers: { "access-control-allow-origin": "*" } });
    return;
  }
  await route.continue();
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") record.consoleErrors.push(m.text());
});
page.on("request", (r) => {
  if (r.url().includes("/album/addPhotos")) record.addPhotosRequests += 1;
});
await page.goto(baseURL + "/");
await page.getByTestId("stats-card-days-number").waitFor({ timeout: 90000 });
await page.goto(`${baseURL}/album-detail?id=zip-album-kyoto`);
await page.getByTestId("album-detail-add").waitFor({ timeout: 60000 });

// + → ファイル選択（expo-image-picker の Web は <input type=file multiple> を開く）→ 45 枚
const chooser = page.waitForEvent("filechooser");
await page.getByTestId("album-detail-add").click();
const fc = await chooser;
record.chooserMultiple = fc.isMultiple();
await fc.setFiles(Array.from({ length: 45 }, () => asset));

await page.getByTestId("album-detail-upload-confirm").waitFor({ timeout: 30000 });
record.confirmText = await page.getByTestId("album-detail-upload-confirm").textContent();
await shot(page, "pink-album-detail-upload-confirm");

await page.getByTestId("album-detail-upload-start").click();
await page.getByTestId("album-detail-upload-abort").waitFor({ timeout: 30000 });
// 1 つ目の塊（20 枚）が済んで 2 つ目に入ったところで「やめる」
await page.waitForFunction(() => {
  const el = document.querySelector('[data-testid="album-detail-progress"]');
  return el && /^2[2-9] \//.test(el.textContent ?? "");
}, null, { timeout: 60000 });
record.progressTexts.push(await page.getByTestId("album-detail-progress").textContent());
await shot(page, "pink-album-detail-upload-progress");
await page.getByTestId("album-detail-upload-abort").click();
await page.waitForFunction(() => !document.querySelector('[data-testid="album-detail-progress"]'), null, { timeout: 30000 });
await page.waitForTimeout(300);
record.noticeText = await page.getByText(/枚まで入りました|入れられませんでした|送れませんでした/).first().textContent();
await shot(page, "pink-album-detail-upload-aborted");

await browser.close();
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2));
console.log("done", JSON.stringify({ ...record, consoleErrors: record.consoleErrors.length }));

// 048 段階1: 本物のバンドル（expo web）で ZIP を組んで保存できることを確かめ、落ちた ZIP を開いて中身を記録する。
// fflate が Expo Web のバンドルで動くか（タスク定義 2節「先に確かめる」）はここで見る。
//   node capture.mjs <baseURL> <outDir> <cookieFile>
// - ログイン状態は make-session.mjs が作った Cookie で再現する
// - ローカルの署名付き URL は本物の R2 を指して 404 になるので、R2 の GET を Playwright の route で受け止め、
//   packages/db/seed/assets の JPEG を返す（写真ごとに 4 枚を順に。中身の一致を見るため）
// - ダウンロードは page.on("download") で受けて outDir に保存し、fflate の unzipSync で開く
// - 1 アルバム（3 枚・説明文あり）: 詳細の ⋯ → ZIP で保存。全部（3 + 101 = 104 枚）: 一覧の ⋯ → 2 つに分かれる
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const { unzipSync, strFromU8 } = require(path.join(repoRoot, "apps", "app", "node_modules", "fflate"));

const args = process.argv.slice(2);
const [baseURL = "http://localhost:8081", outDir = "out", cookieFile = "session-cookie.txt"] = args.filter((a) => !a.startsWith("--"));
const apiOrigin = "http://localhost:8787";
mkdirSync(outDir, { recursive: true });

const cookieValue = readFileSync(cookieFile, "utf8").trim();
const sessionCookie = { name: "better-auth.session_token", value: cookieValue, url: apiOrigin, httpOnly: true, sameSite: "Lax" };

const assetsDir = path.join(repoRoot, "packages", "db", "seed", "assets");
const assets = ["meetup-1.jpg", "meetup-2.jpg", "meetup-3.jpg", "meetup-4.jpg"].map((f) => readFileSync(path.join(assetsDir, f)));
// 署名付き URL の鍵（.../albums/{imageId}.jpg）から、どの見本を返すかを決める（imageId の末尾の数字）
function assetFor(url) {
  const m = /albums\/[A-Z]+0*(\d+)\.jpg/.exec(new URL(url).pathname);
  const n = m ? Number(m[1]) : 1;
  return { index: (n - 1) % assets.length, bytes: assets[(n - 1) % assets.length] };
}

const record = { consoleErrors: [], r2Requests: 0, single: null, all: null };

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
}
async function shot(page, name) {
  await settle(page);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("shot", file);
}
async function waitHome(page) {
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 90000 });
}
async function setAppearance(page, mode) {
  await page.evaluate((m) => {
    if (m === "pink") window.localStorage.removeItem("futary.appearance");
    else window.localStorage.setItem("futary.appearance", m);
  }, mode);
  await page.reload();
}

// ダウンロードを待って保存し、開いた中身を返す
function collectDownloads(page, expected) {
  return new Promise((resolve) => {
    const files = [];
    page.on("download", async (download) => {
      const filename = download.suggestedFilename();
      const file = path.join(outDir, filename);
      await download.saveAs(file);
      const bytes = readFileSync(file);
      const entries = unzipSync(new Uint8Array(bytes));
      const names = Object.keys(entries);
      const captions = entries["captions.txt"] ? strFromU8(entries["captions.txt"]) : null;
      // 写真の中身が route で返した見本と一致するか（先頭 3 枚だけ全バイト比較）
      const matches = names
        .filter((n) => n.endsWith(".jpg"))
        .slice(0, 3)
        .map((n) => {
          const m = /-([A-Z]+0*\d+)\.jpg$/.exec(n);
          const id = m ? m[1] : "";
          const num = Number(/0*(\d+)$/.exec(id)?.[1] ?? "1");
          const expectedBytes = assets[(num - 1) % assets.length];
          return { name: n, size: entries[n].byteLength, equal: Buffer.compare(Buffer.from(entries[n]), expectedBytes) === 0 };
        });
      files.push({ filename, bytes: bytes.byteLength, entries: names.length, jpgs: names.filter((n) => n.endsWith(".jpg")).length, hasCaptions: captions !== null, captionLines: captions ? captions.split("\n").filter(Boolean).length : 0, captions, firstNames: names.slice(0, 3), lastNames: names.slice(-2), matches });
      console.log("download", filename, bytes.byteLength, "bytes,", names.length, "entries");
      if (files.length === expected) resolve(files);
    });
  });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
await context.addCookies([sessionCookie]);
// 本物の R2 への GET を見本の JPEG で受け止める（署名付き URL のホストは r2.cloudflarestorage.com）
await context.route(/r2\.cloudflarestorage\.com/, async (route) => {
  record.r2Requests += 1;
  const { bytes } = assetFor(route.request().url());
  await route.fulfill({ status: 200, contentType: "image/jpeg", body: bytes, headers: { "access-control-allow-origin": "*" } });
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") record.consoleErrors.push(m.text());
});
await page.goto(baseURL + "/");
await waitHome(page);

// --- 1 アルバム（京都旅行・3 枚）: 詳細の ⋯ → ZIP で保存。ピンクとホワイトで確認のシートを撮る ---
for (const mode of ["pink", "white"]) {
  await page.goto(baseURL + "/");
  await waitHome(page);
  await setAppearance(page, mode);
  await waitHome(page);
  await page.goto(`${baseURL}/album-detail?id=zip-album-kyoto`);
  await page.getByTestId("album-photo-ZIPALBUMKYOTO00000000001").waitFor({ timeout: 60000 });
  await page.getByTestId("album-detail-menu").click();
  await page.getByTestId("album-detail-zip").waitFor();
  await shot(page, `${mode}-album-detail-menu`);
  await page.getByTestId("album-detail-zip").click();
  await page.getByTestId("zip-export-confirm").waitFor({ timeout: 30000 });
  await shot(page, `${mode}-album-detail-zip-confirm`);
  if (mode === "pink") {
    const confirmText = await page.getByTestId("zip-export-confirm").textContent();
    const downloads = collectDownloads(page, 1);
    await page.getByTestId("zip-export-start").click();
    const files = await downloads;
    await page.getByTestId("zip-export-done").waitFor({ timeout: 60000 });
    await shot(page, `${mode}-album-detail-zip-done`);
    record.single = { confirmText, doneText: await page.getByTestId("zip-export-done").textContent(), failedText: (await page.getByTestId("zip-export-failed").count()) ? await page.getByTestId("zip-export-failed").textContent() : "(無し)", files };
    await page.getByTestId("zip-export-close").click();
  } else {
    await page.getByText("キャンセル").click();
  }
}

// --- 全部（一覧の ⋯ → すべての写真を ZIP で保存）: 3 + 101 = 104 枚 → 2 つ ---
await page.goto(`${baseURL}/album`);
await page.getByTestId("album-timeline-card").waitFor({ timeout: 60000 });
await page.getByTestId("album-list-menu").click();
await page.getByTestId("album-list-zip").waitFor();
await shot(page, "white-album-list-menu");
await page.getByTestId("album-list-zip").click();
await page.getByTestId("zip-export-confirm").waitFor({ timeout: 60000 });
await shot(page, "white-album-list-zip-confirm");
{
  const confirmText = await page.getByTestId("zip-export-confirm").textContent();
  const partsText = await page.getByTestId("zip-export-parts").textContent();
  const downloads = collectDownloads(page, 2);
  await page.getByTestId("zip-export-start").click();
  await page.getByTestId("zip-export-progress").waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
  await shot(page, "white-album-list-zip-progress");
  const progressText = await page.getByTestId("zip-export-progress").textContent().catch(() => "(既に完了)");
  const files = await downloads;
  await page.getByTestId("zip-export-done").waitFor({ timeout: 120000 });
  await shot(page, "white-album-list-zip-done");
  record.all = { confirmText, partsText, progressText, doneText: await page.getByTestId("zip-export-done").textContent(), failedText: (await page.getByTestId("zip-export-failed").count()) ? await page.getByTestId("zip-export-failed").textContent() : "(無し)", files };
  await page.getByTestId("zip-export-close").click();
}

// --- マイページの入口（押してシートが開くところまで。保存はしない） ---
await page.goto(`${baseURL}/profile`);
await page.getByTestId("profile-zip").waitFor({ timeout: 60000 });
await page.getByTestId("profile-zip").scrollIntoViewIfNeeded();
await shot(page, "white-profile-zip-row");
await page.getByTestId("profile-zip").click();
await page.getByTestId("zip-export-confirm").waitFor({ timeout: 60000 });
await shot(page, "white-profile-zip-confirm");
record.profileConfirmText = await page.getByTestId("zip-export-confirm").textContent();
await page.getByText("キャンセル").click();

// --- PC 幅で詳細のヘッダー（⋯ が編集・選択の隣にある） ---
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${baseURL}/album-detail?id=zip-album-kyoto`);
await page.getByTestId("album-detail-menu").waitFor({ timeout: 60000 });
await shot(page, "white-album-detail-pc");

await browser.close();
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2));
console.log("done. consoleErrors:", record.consoleErrors.length, "r2Requests:", record.r2Requests);

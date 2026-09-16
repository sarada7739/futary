// 057: 両モード（pink / white）で、マイページの「運営 ›」・/admin の全体の数・探した結果・切り替えの確認・
// 直近の操作を撮る。ログイン状態は 045 の make-session.mjs の Cookie（shot-me@example.com。ローカルの
// .dev.vars の ADMIN_EMAILS に入れてある）。探すのは同じペアの相手（shot-partner@example.com）。
//   node capture.mjs <baseURL> <outDir> <cookieFile>
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const [baseURL = "http://localhost:8081", outDir = "out", cookieFile = "session-cookie.txt"] = args.filter((a) => !a.startsWith("--"));
// --stripe: ペアの行が source='stripe' の状態（ボタンが無く「Stripe で管理」）を撮って終わる
const stripeOnly = args.includes("--stripe");
const apiOrigin = "http://localhost:8787";
mkdirSync(outDir, { recursive: true });
const cookieValue = readFileSync(cookieFile, "utf8").trim();
const sessionCookie = { name: "better-auth.session_token", value: cookieValue, url: apiOrigin, httpOnly: true, sameSite: "Lax" };

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
}
async function shot(page, name) {
  await settle(page);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log("shot", name);
}
async function setAppearance(page, mode) {
  await page.evaluate((m) => {
    if (m === "pink") window.localStorage.removeItem("futary.appearance");
    else window.localStorage.setItem("futary.appearance", m);
  }, mode);
  await page.reload();
}
function finishModalAnimations(page) {
  return page.evaluate(() => {
    for (const node of Array.from(document.body.querySelectorAll("*"))) {
      node.dispatchEvent(new Event("webkitAnimationEnd", { bubbles: true }));
      node.dispatchEvent(new Event("animationend", { bubbles: true }));
    }
  });
}

const record = { stats: {}, lookup: {}, actions: {}, consoleErrors: [] };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await context.addCookies([sessionCookie]);
const page = await context.newPage();
page.setDefaultNavigationTimeout(180000);
page.on("console", (m) => {
  if (m.type() === "error") record.consoleErrors.push(m.text());
});
await page.goto(baseURL + "/", { timeout: 180000 });
await page.getByTestId("stats-card-days-number").waitFor({ timeout: 180000 });

for (const mode of ["pink", "white"]) {
  await page.goto(baseURL + "/");
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 60000 });
  await setAppearance(page, mode);
  await page.getByTestId("stats-card-days-number").waitFor({ timeout: 60000 });

  // マイページの「運営 ›」
  await page.goto(`${baseURL}/profile`);
  await page.getByTestId("profile-admin").waitFor({ timeout: 60000 });
  await page.getByTestId("profile-admin").scrollIntoViewIfNeeded();
  await shot(page, `${mode}-profile-admin-link`);
  await page.getByTestId("profile-admin").click();

  // /admin: 全体の数
  await page.getByTestId("admin-stat-couples").waitFor({ timeout: 60000 });
  record.stats[mode] = await page.getByTestId("admin-stat-couples").textContent();
  await shot(page, `${mode}-admin-stats`);

  // 探す
  await page.getByTestId("admin-lookup-email").fill("shot-partner@example.com");
  await page.getByTestId("admin-lookup-submit").click();
  await page.getByTestId("admin-lookup-couple").waitFor({ timeout: 30000 });
  await page.getByTestId("admin-lookup-user").scrollIntoViewIfNeeded();
  record.lookup[mode] = {
    plan: await page.getByTestId("admin-couple-plan").textContent(),
    source: await page.getByTestId("admin-couple-source").textContent(),
  };
  if (stripeOnly) {
    await page.getByTestId("admin-couple-stripe").waitFor({ timeout: 10000 });
    await page.getByTestId("admin-couple-stripe").scrollIntoViewIfNeeded();
    record.lookup[mode].stripe = await page.getByTestId("admin-couple-stripe").textContent();
    await shot(page, `${mode}-admin-lookup-stripe`);
    continue;
  }
  await shot(page, `${mode}-admin-lookup`);

  // 切り替え（paid なら無料に、free ならプレミアムに）→ 確認 → 変更
  const toFree = (await page.getByTestId("admin-set-free").count()) > 0;
  await page.getByTestId(toFree ? "admin-set-free" : "admin-set-paid").click();
  await page.getByTestId("admin-confirm-text").waitFor({ timeout: 10000 });
  await shot(page, `${mode}-admin-confirm`);
  await page.getByTestId("admin-confirm").click();
  await finishModalAnimations(page);
  await page.getByTestId("admin-notice").waitFor({ timeout: 30000 });
  await page.getByTestId(toFree ? "admin-set-paid" : "admin-set-free").waitFor({ timeout: 30000 });
  const first = page.locator('[data-testid^="admin-action-"]').first();
  await first.waitFor({ timeout: 30000 });
  await first.scrollIntoViewIfNeeded();
  record.actions[mode] = await first.textContent();
  await shot(page, `${mode}-admin-actions`);
}
await context.close();
await browser.close();
writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));

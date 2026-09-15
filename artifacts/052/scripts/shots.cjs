// 052: 証跡のスクリーンショット。api-dev（8787。build:public 済み）と app-web（8081）が動いている前提。
// 実行: node artifacts/052/scripts/shots.cjs
// 出力: artifacts/052/stage1/*.png
const path = require("node:path");
const { chromium } = require("@playwright/test");

const OUT = path.resolve(__dirname, "..", "stage1");
const API = "http://localhost:8787";
const APP = "http://localhost:8081";

async function main() {
  const browser = await chromium.launch();
  try {
    // ランディングの 3 ページ（スマホ幅。横スクロールが無いことも見る）
    for (const [name, url] of [
      ["landing-privacy", `${API}/privacy`],
      ["landing-terms", `${API}/terms`],
      ["landing-footer", `${API}/`],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle" });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      console.log(`${name}: scrollWidth=${scrollWidth} (viewport 390)`);
      if (name === "landing-footer") {
        await page.locator("footer").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      } else {
        await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
      }
      await ctx.close();
    }

    // アプリ: サインイン画面（リンクの位置）
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    // Expo の開発サーバは networkidle にならない（HMR の接続が残る）ので、画面の文字で待つ
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.getByText("ゲストではじめる").waitFor({ timeout: 60_000 });
    await page.screenshot({ path: path.join(OUT, "app-sign-in.png") });

    // 押すと新しいタブで /privacy が開く
    const [popup] = await Promise.all([
      ctx.waitForEvent("page"),
      page.getByTestId("legal-privacy").click(),
    ]);
    await popup.waitForLoadState();
    console.log(`sign-in → legal-privacy → 新しいタブ: ${popup.url()}`);
    await popup.close();

    // ゲストで入ってマイページ（ログイン案内の下のリンク）
    await page.getByText("ゲストではじめる").click();
    // タブバーの文字は上の View に pointer を取られて click() が通らないので、
    // 要素に直接 click イベントを投げる（Pressable まで泡立つ）
    const tab = page.getByText("マイページ").first();
    await tab.waitFor({ timeout: 60_000 });
    await tab.dispatchEvent("click");
    try {
      await page.getByText("マイページはログインすると使えます").waitFor({ timeout: 30_000 });
    } catch (e) {
      console.log(`debug: url=${page.url()}`);
      await page.screenshot({ path: path.join(OUT, "debug-profile.png") });
      throw e;
    }
    // 3.0.0 の「新機能のお知らせ」のシートが下を覆う（リンクも隠れる）ので閉じてから撮る
    const close = page.getByText("閉じる").first();
    if (await close.isVisible().catch(() => false)) {
      await close.dispatchEvent("click");
      await close.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    }
    await page.getByTestId("legal-terms").waitFor({ timeout: 30_000 });
    await page.screenshot({ path: path.join(OUT, "app-profile-guest.png") });
    // マイページ側も上の View に pointer を取られるので click イベントを直接投げる
    const [popup2] = await Promise.all([
      ctx.waitForEvent("page"),
      page.getByTestId("legal-terms").dispatchEvent("click"),
    ]);
    await popup2.waitForLoadState();
    console.log(`profile(guest) → legal-terms → 新しいタブ: ${popup2.url()}`);
    await popup2.close();
    await ctx.close();
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

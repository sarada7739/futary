import { expect, test } from "@playwright/test";

// 未認証のデモ閲覧経路のみを対象にするE2E（docs/tasks/016-release.md・
// conventions.md 6節）。認証を伴う導線（ログイン→投稿→リアクション等）は
// ここでは自動化しない（人間の実機確認に委ねる）。
//
// 「デモを開く → 閲覧できる → 書き込みが拒否される」の3ステップを検証する。
test.describe("未認証のデモ閲覧経路", () => {
  test("ゲストではじめるとデモデータが閲覧でき、書き込みは拒否される", async ({ page }) => {
    await page.goto("/app/");

    await page.getByText("ゲストではじめる").click();

    // 閲覧できる: デモバナーとデモデータ（記念日カード）が表示される
    await expect(page.getByText("これはデモです")).toBeVisible();
    await expect(page.getByText(/付き合って\s*\d+日目/)).toBeVisible();

    // 書き込みが拒否される: writeProcedure配下の手続き（couple.update）を
    // 未認証のまま直接叩き、FORBIDDENで拒否されることを確認する
    // （apps/api/test/method-restriction.test.ts と同じ入力形状）
    const result = await page.evaluate(async () => {
      const response = await fetch("/api/couple/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          json: { datingDate: "2020-01-01", marriedDate: null, primaryDate: "dating" },
        }),
      });
      const body = await response.json();
      return { status: response.status, body };
    });

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ json: { code: "FORBIDDEN" } });
  });
});

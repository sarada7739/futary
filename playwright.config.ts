import { defineConfig } from "@playwright/test";

// 未認証のデモ閲覧経路のみを対象にする（conventions.md 6節）。
// 認証を伴う導線はここでは自動化しない
const port = process.env.E2E_PORT ?? "8799";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: baseURL,
    // マイグレーション・シード投入・ビルド・wrangler dev起動を含むため、
    // 単純な起動より時間がかかる
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: port },
  },
});

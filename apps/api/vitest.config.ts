import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// D1 のマイグレーションはテスト用DBに自動適用されないため、
// migrations_dir の内容を読み込んでバインディング経由でセットアップに渡す
const migrationsPath = path.join(import.meta.dirname, "..", "..", "packages", "db", "migrations");

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readD1Migrations(migrationsPath) },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});

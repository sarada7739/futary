import { applyD1Migrations, env } from "cloudflare:test";

// vitest.config.ts の TEST_MIGRATIONS バインディング経由で渡されたマイグレーションを
// テスト用D1に適用する（自動適用されないため、テスト実行前に毎回明示的に行う）
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS);

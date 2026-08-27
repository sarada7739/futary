import { defineConfig } from "drizzle-kit";

// スキーマは packages/db/src/schema/ 配下が唯一の源。
// マイグレーションSQLはここから `pnpm db:generate` で生成する
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./migrations",
});

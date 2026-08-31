// 016のE2E（未認証のデモ閲覧経路。docs/tasks/016-release.md）用に、
// ローカルD1へマイグレーションとデモシードを適用してから
// wrangler dev（本番と同じ単一オリジン構成。apps/api/public を配信）を
// フォアグラウンドで起動する。playwright.config.ts の webServer から呼ぶ。
//
// マイグレーション・シードはどちらも既存データに対して安全に繰り返し実行できる
// 設計になっている（マイグレーションはd1_migrationsで適用済みを記録、
// シードはpackages/db/seed/run.tsが固定IDの安全確認をしてから上書きする）。
//
// pnpm経由で子プロセスを起動すると、Windowsではpnpm.cmdをシェル経由でしか
// 起動できない問題が起きる（packages/db/seed/run.tsと同じ理由）。
// ここではNode本体で各スクリプトを直接起動する
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(repoRoot, "apps", "api");
const dbDir = path.join(repoRoot, "packages", "db");
const wranglerJs = path.join(apiDir, "node_modules", "wrangler", "bin", "wrangler.js");

function run(cwd, args) {
  execFileSync(process.execPath, args, { cwd, stdio: "inherit" });
}

console.log("[e2e] ローカルD1へマイグレーションを適用します...");
run(apiDir, [wranglerJs, "d1", "migrations", "apply", "DB", "--local"]);

console.log("[e2e] デモシードを投入します...");
run(dbDir, [path.join(dbDir, "seed", "run.ts"), "--local"]);

console.log("[e2e] 公開ディレクトリをビルドします...");
run(repoRoot, [path.join(repoRoot, "scripts", "build-public.mjs")]);

const port = process.env.E2E_PORT ?? "8799";
console.log(`[e2e] wrangler dev --local --port ${port} を起動します...`);
const result = spawnSync(process.execPath, [wranglerJs, "dev", "--local", "--port", port], {
  cwd: apiDir,
  stdio: "inherit",
});
process.exit(result.status ?? 1);

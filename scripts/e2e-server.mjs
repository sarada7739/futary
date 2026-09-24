// E2E（未認証のデモ閲覧経路）用に、ローカル D1 へマイグレーションとデモシードを当ててから
// wrangler dev（本番と同じ単一オリジン）を起動する。playwright.config.ts の webServer から呼ぶ。
// どちらも繰り返し実行して安全（マイグレーションは適用済みを記録し、シードは固定 ID を確かめてから上書きする）。
// Windows では pnpm.cmd をシェル経由でしか起動できないので、Node で各スクリプトを直接起動する
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

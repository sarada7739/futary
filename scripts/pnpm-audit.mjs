// pnpm audit を呼ぶ 3 箇所（ci.yml・deploy.yml の 2 ステップ・check-audit-ignore-staleness.mjs）が
// 通るラッパー。リトライの設定をここ 1 箇所にまとめる（034）。
//
// npm の勧告 API への通信が間欠的にタイムアウトして CI とデプロイを止めたので、リトライを増やす。
// pnpm 11 では .npmrc の fetch-retries・npm_config_fetch_retries 環境変数は効かず、CLI フラグだけが
// 効く（artifacts/034/npmrc-vs-cli-flag.md）。
// リトライは通信の失敗にだけ効き、脆弱性ありの正常な応答では 1 回で終わる（artifacts/034/vuln-no-retry.md）。
// このラッパーは再試行を判断せず、pnpm の終了コードをそのまま返す
import { spawnSync } from "node:child_process";

const AUDIT_RETRY_ARGS = ["--fetch-retries=5"];

const result = spawnSync("pnpm", ["audit", ...AUDIT_RETRY_ARGS, ...process.argv.slice(2)], {
  stdio: "inherit",
  // Windows では "pnpm" が .cmd のシムで、shell 経由でないと解決できない（CI は Linux だが開発機でも動かす）
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

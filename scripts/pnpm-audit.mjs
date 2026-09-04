// pnpm audit を叩く箇所は3つある（ci.yml・deploy.ymlの出力専用ステップと
// ゲートステップ、check-audit-ignore-staleness.mjs内部の呼び出し）。
// リトライの設定をここ1箇所にまとめ、3箇所すべてがこのラッパーを経由する
// （docs/tasks/034-audit-retry.md 4節）。
//
// npmのセキュリティ勧告APIへの通信が間欠的にタイムアウトし、CI・デプロイの
// 両方を止めた（2026-09-04。5回。詳細はartifacts/034/）。pnpmは既定で
// fetch-retries=2（10秒→1分、計2回リトライ）で通信するが、これでは足りない
// 障害があったため、リトライ回数を底上げする。
//
// 実測（artifacts/034/npmrc-vs-cli-flag.md）: .npmrcのfetch-retries設定・
// npm_config_fetch_retries環境変数は、いずれもpnpm 11.24.0のfetch-retriesに
// 対して効果が無かった（到達不能なレジストリに向けた実行で、既定の2回から
// 変化しないことを確認した）。CLIフラグ --fetch-retries のみが実際に反映される
// ことを、同じ実行環境で確認できたため、ここではCLIフラグとして渡す。
//
// 脆弱性が見つかった場合はリトライしない。実測（artifacts/034/vuln-no-retry.md）:
// 正常な200応答で脆弱性ありを返すモックレジストリに対し --fetch-retries=5 を
// 付けても、リクエストは1回だけで即座に非ゼロ終了することを確認した
// （retriesは通信そのものの失敗にのみ効き、正常応答の中身には効かない）。
// このラッパー自身は再試行の可否を判断していない。pnpm自身の判断と
// 終了コードをそのまま返すだけである。
import { spawnSync } from "node:child_process";

const AUDIT_RETRY_ARGS = ["--fetch-retries=5"];

const result = spawnSync("pnpm", ["audit", ...AUDIT_RETRY_ARGS, ...process.argv.slice(2)], {
  stdio: "inherit",
  // Windowsでは"pnpm"が.cmdシムのため、shell経由でないと解決できない
  // （ENOENTを実測して判明。GitHub Actions実行環境はubuntu-latestのため
  // 本来は不要だが、開発機（Windows）でも同じスクリプトが動くようにする）
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

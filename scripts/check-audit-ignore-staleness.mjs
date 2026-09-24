// 無視リスト（pnpm-workspace.yaml の auditConfig.ignoreGhsas）の陳腐化の検出（security-requirements.md 9節）。
// 無視リストを外した状態の pnpm audit に登録した GHSA がまだ現れるかを見て、現れなければ（修正版が出た・
// 依存が消えた）赤くする。CLI に一時的に外すオプションが無いので、auditConfig を取り除いたコピーで
// 実行して戻す。そのために:
// 1. 途中で失敗しても元に戻す（main() の try/finally。finally を通すため process.exit() でなく return で抜ける）
// 2. レジストリの障害で赤にしない（--ignore-registry-errors。応答が不完全なら判定を見送る）
import { execSync } from "node:child_process";
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const WORKSPACE_FILE = "pnpm-workspace.yaml";
const BACKUP_FILE = `${WORKSPACE_FILE}.audit-staleness-backup`;

function main() {
  const original = readFileSync(WORKSPACE_FILE, "utf8");

  const ignoreGhsas = [...original.matchAll(/^\s*-\s*(GHSA-\S+)/gm)].map((m) => m[1]);
  if (ignoreGhsas.length === 0) {
    console.log("ignoreGhsas が空のため、陳腐化検出は不要です。");
    return;
  }

  const withoutAuditConfig = original.replace(/\n(?:#[^\n]*\n)*auditConfig:[\s\S]*$/, "\n");
  if (withoutAuditConfig === original) {
    throw new Error(
      "auditConfig セクションを取り除けませんでした。pnpm-workspace.yaml の形式を確認してください",
    );
  }

  copyFileSync(WORKSPACE_FILE, BACKUP_FILE);
  try {
    writeFileSync(WORKSPACE_FILE, withoutAuditConfig);

    let rawOutput;
    try {
      // レジストリの障害だけで赤くしない（検査そのものを止める圧力を作らない）。リトライは pnpm-audit.mjs
      rawOutput = execSync("node scripts/pnpm-audit.mjs --json --ignore-registry-errors", {
        encoding: "utf8",
      });
    } catch (error) {
      // pnpm audit は脆弱性が見つかると非ゼロ終了するため、stdout を拾う
      rawOutput = error.stdout?.toString() ?? "";
    }

    let rawResult;
    try {
      rawResult = JSON.parse(rawOutput);
    } catch {
      console.warn("pnpm audit の出力を解析できませんでした（レジストリ障害等の可能性）。判定を見送ります。");
      return;
    }

    // metadata.vulnerabilities が無いのは audit が正常に走らなかった兆候。「空 = 陳腐化」と誤判定しないよう見送る
    if (typeof rawResult.metadata?.vulnerabilities !== "object") {
      console.warn("pnpm audit の結果が想定した形式ではありませんでした。判定を見送ります。");
      return;
    }

    const currentGhsas = new Set(
      Object.values(rawResult.advisories ?? {}).map((advisory) => advisory.github_advisory_id),
    );

    const stale = ignoreGhsas.filter((id) => !currentGhsas.has(id));
    if (stale.length > 0) {
      console.error("無視リストに陳腐化した項目があります（もう audit 結果に現れません）:");
      for (const id of stale) console.error(`  - ${id}`);
      console.error(
        "修正版が出たか依存が消えたと考えられます。pnpm-workspace.yaml から削除してください（登録できるのは A のみ）。",
      );
      process.exitCode = 1;
    } else {
      console.log(`無視リストの${ignoreGhsas.length}件は、いずれも現在のaudit結果に存在します（陳腐化なし）。`);
    }
  } finally {
    copyFileSync(BACKUP_FILE, WORKSPACE_FILE);
    unlinkSync(BACKUP_FILE);
  }
}

main();

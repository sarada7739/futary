// 無視リスト（pnpm-workspace.yaml の auditConfig.ignoreGhsas）の陳腐化検出。
// 登録された GHSA が、無視リストを外した状態の pnpm audit にまだ現れるかを見る。
// 現れなくなっていたら、その項目はもう不要（修正版が出た・依存が消えた）なので
// 赤くする（security-requirements.md 9節「陳腐化の検出」）。
//
// pnpm audit の CLI には無視リストを一時的に外すオプションが無いため、
// auditConfig セクションを取り除いた一時的なコピーで audit を実行し、
// 実行後は元に戻す。
//
// リポジトリのファイルを書き換える手法である以上、2つの性質を満たす
// （security-requirements.md 9節）。
// 1. 途中で失敗しても pnpm-workspace.yaml が元に戻る
//    （下記 main() 内の try/finally。finally を確実に通すため、
//    早期リターンは process.exit() ではなく関数の return を使う）
// 2. レジストリの障害で赤にしない（--ignore-registry-errors、および
//    出力が audit の応答として不完全なときは判定を見送る）
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
      // --ignore-registry-errors: レジストリの障害だけで赤くしない
      // （security-requirements.md 9節）。検査そのものを殺す圧力を作らないため
      rawOutput = execSync("pnpm audit --json --ignore-registry-errors", { encoding: "utf8" });
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

    // metadata.vulnerabilities が無いのは、レジストリ障害等で audit が正常に
    // 走らなかった兆候。「advisories が空 = 陳腐化」と誤判定しないよう見送る
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

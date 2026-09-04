import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoSeed, buildDemoSeedSql, type DemoSeed } from "./demo.ts";

// デモペアのシードをD1・R2へ投入するCLI（docs/tasks/014-guest-demo.md）。
// 014はローカル（--local）まで、016はこれをそのまま --remote で呼ぶ
// （architecture.md 6節: ローカルD1とリモートD1は別物。同じ生成ロジックを
// 使い回すことで、投入内容が食い違う経路を作らない）
//
// wrangler.toml（D1/R2バインディングの設定）は apps/api にあるため、
// wrangler CLI は apps/api を cwd にして呼ぶ

const seedDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(seedDir, "../../../apps/api");
const assetsDir = path.join(seedDir, "assets");

function parseTarget(argv: string[]): "--local" | "--remote" {
  if (argv.includes("--remote")) return "--remote";
  if (argv.includes("--local")) return "--local";
  throw new Error("--local または --remote のどちらかを指定してください");
}

// apps/api の node_modules から wrangler のJS本体を直接 node で実行する。
// node_modules/.bin/wrangler(.cmd) を経由すると、Windowsでは.cmdをシェル
// 経由でしか起動できず（shell:trueは引数を自前でエスケープしないと
// インジェクションの余地を残す。DEP0190で警告される）、npxはWindowsでは
// npx.cmdでありexecFileSyncにそのまま"npx"を渡すとENOENTになる。
// process.execPathでJSファイルを直接起動すればshellを経由しない
const wranglerJs = path.join(apiDir, "node_modules", "wrangler", "bin", "wrangler.js");

function runWrangler(args: string[]): void {
  execFileSync(process.execPath, [wranglerJs, ...args], { cwd: apiDir, stdio: "inherit" });
}

function runWranglerCaptured(args: string[]): string {
  return execFileSync(process.execPath, [wranglerJs, ...args], { cwd: apiDir, encoding: "utf8" });
}

interface D1ExecuteResult {
  results: Array<Record<string, unknown>>;
}

// このIDが実在し、かつ is_demo でないペアを指していないことを確認してから
// でないと、あとに続くDELETE群（buildDeleteSql）とR2への上書きが本物の
// ペアのデータを消してしまう（security-auditor指摘。読み取り側の
// resolveCoupleContext は AND is_demo = 1 で守られているが、シードの
// 削除・上書き側には同じ条件が無かった）。couplesが存在しない
// （＝初回投入）場合は空配列が返るので、そのまま先へ進めてよい
function assertCoupleSafeToOverwrite(target: "--local" | "--remote", coupleId: string): void {
  const output = runWranglerCaptured([
    "d1",
    "execute",
    "DB",
    target,
    "--json",
    "--command",
    `SELECT is_demo FROM couples WHERE id = '${coupleId}'`,
  ]);
  const parsed = JSON.parse(output) as D1ExecuteResult[];
  const rows = parsed[0]?.results ?? [];
  const row = rows[0] as { is_demo: number } | undefined;
  if (row && row.is_demo !== 1) {
    throw new Error(
      `DEMO_COUPLE_ID（${coupleId}）が is_demo=1 でないペアを指しています。` +
        `このまま進めると実ペアのデータを削除・上書きすることになるため中断します。` +
        `wrangler.tomlのDEMO_COUPLE_IDとpackages/db/seed/demo.tsのDEMO_COUPLE_IDが` +
        `一致しているか、対象IDが誤って実ペアに割り当てられていないかを確認してください。`,
    );
  }
}

// buildDeleteSqlの7文のうち、`DELETE FROM user WHERE id IN (...)` だけは
// couple_idスコープでもis_demoの検査対象でもない（Rレビュー指摘R-3）。
// 固定IDはBetter Authが振る実IDと衝突しない前提だが、「固定IDだけで消す」
// という形そのものが監査の指摘だったため、こちらも同じ強さで守る。
// 該当IDのuserが実在するなら、このcoupleのメンバーであることまで確認する
// （couple_membersに居ない・別のcoupleに居るなら中断する）
function assertUsersSafeToOverwrite(target: "--local" | "--remote", coupleId: string, userIds: string[]): void {
  const idList = userIds.map((id) => `'${id}'`).join(", ");
  const output = runWranglerCaptured([
    "d1",
    "execute",
    "DB",
    target,
    "--json",
    "--command",
    `SELECT u.id AS id, cm.couple_id AS couple_id FROM user u ` +
      `LEFT JOIN couple_members cm ON cm.user_id = u.id WHERE u.id IN (${idList})`,
  ]);
  const parsed = JSON.parse(output) as D1ExecuteResult[];
  const rows = (parsed[0]?.results ?? []) as Array<{ id: string; couple_id: string | null }>;
  const unsafe = rows.filter((row) => row.couple_id !== coupleId);
  if (unsafe.length > 0) {
    throw new Error(
      `デモ用の固定ユーザーID（${unsafe.map((r) => r.id).join(", ")}）が、` +
        `このデモペア以外のユーザーとして実在します。このまま進めると無関係な` +
        `ユーザーを削除することになるため中断します。`,
    );
  }
}

function applySql(target: "--local" | "--remote", seed: DemoSeed, sql: string): void {
  assertCoupleSafeToOverwrite(target, seed.coupleId);
  assertUsersSafeToOverwrite(
    target,
    seed.coupleId,
    seed.users.map((u) => u.id),
  );
  const tmpDir = mkdtempSync(path.join(tmpdir(), "futary-seed-"));
  const sqlFile = path.join(tmpDir, "demo-seed.sql");
  try {
    writeFileSync(sqlFile, sql, "utf8");
    // --remoteは--yesを付けない。wranglerが対話確認を出すため、本番D1への
    // 適用は人間の目を必ず一度通す（security-auditor指摘。architecture.md
    // 6節「適用には人間の許可を取る」と同じ理由）。--localはCIやこのCLIの
    // 繰り返し実行を妨げないよう確認を省く
    const args = ["d1", "execute", "DB", target, "--file", sqlFile];
    if (target === "--local") args.push("--yes");
    runWrangler(args);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function uploadImages(target: "--local" | "--remote", images: Array<{ key: string; assetFile: string }>): void {
  for (const image of images) {
    const filePath = path.join(assetsDir, image.assetFile);
    runWrangler(["r2", "object", "put", `futary-images/${image.key}`, "--file", filePath, "--content-type", "image/jpeg", target]);
  }
}

function main(): void {
  const target = parseTarget(process.argv.slice(2));
  const seed = buildDemoSeed();
  const sql = buildDemoSeedSql();

  console.log(
    `デモペアのシードを${target === "--remote" ? "リモート" : "ローカル"}へ投入します: ` +
      `meetup ${seed.events.filter((e) => e.kind === "meetup").length}件 / ` +
      `plan ${seed.events.filter((e) => e.kind === "plan").length}件 / ` +
      `anniversary ${seed.events.filter((e) => e.kind === "anniversary").length}件 / ` +
      `posts ${seed.posts.length}件（うち画像 ${seed.posts.filter((p) => p.images.length > 0).length}件） / ` +
      `images ${seed.images.length}件 / ` +
      `wishes ${seed.wishes.length}件（うち達成済み ${seed.wishes.filter((w) => w.doneAt !== null).length}件） / ` +
      `moods ${seed.moods.length}件`,
  );

  applySql(target, seed, sql);
  uploadImages(target, seed.images);

  console.log("完了。DEMO_COUPLE_ID =", seed.coupleId);
}

main();

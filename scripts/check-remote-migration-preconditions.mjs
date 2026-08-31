// リモートD1への自動マイグレーション適用（.github/workflows/deploy.yml）の
// 直前に走る前提条件チェック。
//
// `packages/db/migrations/0013_event_repeat_yearly_check.sql`の先頭コメントは
// 「リモートD1へ適用する前に、このCHECKに違反する既存行が無いかを数えること」
// と人間向けの手作業を要求している。違反行がある状態で当てると、events本体は
// 無事だが表の作り直し中間テーブル`__new_events`が残骸として残り、是正しないまま
// 再実行すると別のエラー（table __new_events already exists）になる。この状態は
// 人間が手で入るまで、以降の全pushが同じ場所で失敗し続ける
// （PR #170レビューで実測済み）。
//
// デプロイが自動化された（016）ことで、この確認を行う人間がpushの経路上に
// いなくなったため、自動化する（Rレビュー全体監査R-1指摘）。
//
// このチェックは0013適用後もデプロイのたびに無害に実行し続けられる
// （CHECK制約が効いていれば、この条件に一致する行が新たに増えることは無く、
// 常時0件になるはず）。特定のマイグレーション名だけを見て「適用済みか」を
// 判定する複雑さを避けるため、単に毎回このSELECTを実行する設計にした。
//
// 将来、同様に「適用前に人間が数えるべき条件」を持つマイグレーションが
// 増えたら、ここに追記すること（現状はrepeat_yearlyの1件のみ。
// `grep -rl "リモートD1へ適用する前に" packages/db/migrations`で確認できる）。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(repoRoot, "apps", "api");
const wranglerJs = path.join(apiDir, "node_modules", "wrangler", "bin", "wrangler.js");

function queryRemote(sql) {
  const output = execFileSync(
    process.execPath,
    [wranglerJs, "d1", "execute", "DB", "--remote", "--json", "--command", sql],
    { cwd: apiDir, encoding: "utf8" },
  );
  const parsed = JSON.parse(output);
  return parsed[0]?.results ?? [];
}

function main() {
  console.log("0013（events_repeat_yearly_check）のCHECK制約に違反する既存行が無いか確認します...");
  const rows = queryRemote(
    "SELECT COUNT(*) AS count FROM events WHERE repeat_yearly = 1 AND kind <> 'anniversary'",
  );
  const count = Number(rows[0]?.count ?? 0);

  if (count > 0) {
    throw new Error(
      `events_repeat_yearly_check（0013）に違反する既存行が${count}件あります。` +
        `このままマイグレーションを当てると__new_eventsが残骸として残り、以降の` +
        `デプロイが同じ場所で失敗し続けます。事前に是正してください:\n` +
        `  UPDATE events SET repeat_yearly = 0 WHERE repeat_yearly = 1 AND kind <> 'anniversary';\n` +
        `既に__new_eventsが残骸として残っている場合は先に削除すること:\n` +
        `  DROP TABLE IF EXISTS __new_events;`,
    );
  }

  console.log("違反行はありません（0件）。マイグレーションを適用します。");
}

main();

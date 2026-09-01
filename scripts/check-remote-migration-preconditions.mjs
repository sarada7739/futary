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
//
// 【024・Rレビュー指摘】0015（`packages/db/migrations/0015_invite_failures_
// add_account_hash.sql`）は`DELETE FROM invite_failures`を含む、行を消す
// マイグレーションである。`architecture.md`4節「行を消すマイグレーションは、
// 当てる前に件数を数えて記録する」の対象だが、016以降デプロイは無人
// （`production`環境のRequired reviewersはジョブ開始前のapprove、この
// ジョブ自体は無人で走る）で、`worklog.md`へ追記できる人間がpushの経路上に
// いない。0013と同じ理由・同じ仕組みで、件数をこのジョブのログに出力する
// ことをもって「記録する」とする。0013と違い件数が0でなくても止めない
// （このDELETEは常に意図した動作であり、行が残っていること自体が異常では
// ない）。0015適用後の以降のデプロイでもこのSELECT自体は無害に実行され
// 続けるが、その時点ではDELETEはもう走らないため出力される件数に対応する
// 削除は起きない（0013のチェックと同じ「特定のマイグレーション名を見ない」
// 単純さを優先した）
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(repoRoot, "apps", "api");
const wranglerJs = path.join(apiDir, "node_modules", "wrangler", "bin", "wrangler.js");

// 【Rレビュー指摘: fail-openだった】以前は`parsed[0]?.results ?? []`と
// `rows[0]?.count ?? 0`で、結果を正しく読めなかった場合も「0件」（＝安全）と
// 解釈していた。本番のwranglerが実際にどんな形のJSONを返すかはCloudflareの
// 認証情報が無く確認できていない（ローカルD1でしか実測していない）。
// 確かめられない形を安全側と解釈してはならない——このスクリプトは人間が
// デプロイ経路から抜けた穴を塞ぐために足したものであり、その唯一の見張りが
// 「読めなかったら異常なし」ではデプロイを止める意味が無い。`SELECT COUNT(*)`は
// 成功すれば必ずちょうど1行を返すため、それ以外の形は全て異常としてfail-closedにする
function queryRemoteCount(sql) {
  const output = execFileSync(
    process.execPath,
    [wranglerJs, "d1", "execute", "DB", "--remote", "--json", "--command", sql],
    { cwd: apiDir, encoding: "utf8" },
  );
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`wranglerの応答が想定外の形式です（配列でないか空）: ${output.slice(0, 200)}`);
  }
  const rows = parsed[0]?.results;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`resultsが想定外の形式です（ちょうど1行を期待）: ${JSON.stringify(parsed[0]).slice(0, 200)}`);
  }
  // `count: null`はNumber(null)===0でNumber.isFiniteを通過するため素通しする。
  // COUNT(*)がnullを返すことは無いため現状は到達しないが、この関数を
  // 将来MAX()/SUM()を使う条件に再利用したときはnullが返りうる
  // （Rレビュー指摘。再利用時はrows[0].count === nullを弾く一行を足すこと）
  const count = Number(rows[0]?.count);
  if (!Number.isFinite(count)) {
    throw new Error(`count列を数値として読み取れません: ${JSON.stringify(rows[0])}`);
  }
  return count;
}

function main() {
  console.log("0013（events_repeat_yearly_check）のCHECK制約に違反する既存行が無いか確認します...");
  const count = queryRemoteCount(
    "SELECT COUNT(*) AS count FROM events WHERE repeat_yearly = 1 AND kind <> 'anniversary'",
  );

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

  console.log("0015（invite_failuresのaccount_hash追加）で消える既存行数を記録します...");
  const inviteFailureCount = queryRemoteCount("SELECT COUNT(*) AS count FROM invite_failures");
  console.log(
    `invite_failuresの現在の行数: ${inviteFailureCount}件。` +
      `0015が未適用ならこの件数がDELETEで消える（1時間の時間窓で自然に切れる` +
      `一時的なレート制限記録のため、消えること自体は想定どおり。` +
      `architecture.md 4節の記録として、このログをもって記録済みとする）。`,
  );
}

main();

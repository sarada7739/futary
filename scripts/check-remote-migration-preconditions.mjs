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
      `architecture.md 4節「記録する」はworklog.mdの重さ。このジョブログは` +
      `数を出す場所でしかない。この件数をworklog.mdへ写すこと` +
      `〈マージした者の担当〉。PR #189）。`,
  );

  // 【031・security-auditor指摘、Rが実測して訂正】旧posts.image_width/
  // image_heightはNULL許容だった（0003_post.sql）。旧contractのpost.create
  // もimageIdだけを送りimageWidth/imageHeightを省略できる形になっていた
  // （アプリ自身は常に3つを揃えて送っていたが、契約上は独立してoptionalだった）。
  // post_images側はwidth/height共にNOT NULLのため、image_keyがあり
  // width/heightのどちらかがNULLの行が1件でもあると0019のINSERTが
  // NOT NULL違反で失敗する。**CREATE TABLEとCREATE UNIQUE INDEXは成功済みの
  // ため、post_images・post_images_key_uniqueが残骸として残る**（0013と
  // 同じ形。Rが実測: 是正せず再実行すると`table post_images already exists`
  // で同じ場所に落ち続ける）。0013と同じくfail-closedで止める
  console.log("0019のNOT NULL列（post_images.width/height）に違反する既存行が無いか確認します...");
  let malformedImageCount;
  try {
    malformedImageCount = queryRemoteCount(
      "SELECT COUNT(*) AS count FROM posts WHERE image_key IS NOT NULL AND deleted_at IS NULL " +
        "AND (image_width IS NULL OR image_height IS NULL)",
    );
  } catch {
    // image_key列が既に無い（0019適用済み）。移行は完了しているため0件として扱う
    malformedImageCount = 0;
  }
  if (malformedImageCount > 0) {
    throw new Error(
      `image_keyがありimage_width/image_heightのどちらかがNULLの既存行が` +
        `${malformedImageCount}件あります。このままマイグレーションを当てると` +
        `CREATE TABLE/CREATE UNIQUE INDEXは成功したままpost_images.width/height` +
        `のNOT NULL制約違反でINSERTが失敗し、post_images・post_images_key_unique` +
        `が残骸として残ります。是正しないまま再実行するとtable post_images ` +
        `already existsで同じ場所に落ち続けます。事前に是正してください` +
        `（その投稿の画像を除いてもよいかを判断する。例: 実寸が分からないなら` +
        `画像参照ごと外す）:\n` +
        `  DROP TABLE IF EXISTS post_images;\n` +
        `是正後、残骸が既に残っている場合は上のDROP TABLEを先に実行してから` +
        `再実行すること。`,
    );
  }
  console.log("違反行はありません。マイグレーションを適用します。");

  // 【031・タスク定義4節】0019はposts.image_key/image_width/image_heightを
  // post_imagesへ移してから列を落とす。列を消すが、行（の一部）は
  // post_imagesへ形を変えて残る（0015のDELETEとは違い消滅ではない）。
  // それでも「行を消すマイグレーションは、当てる前に件数を数えて記録する」
  // （architecture.md 4節）と同じ理由で、この列がposts.image_keyという形として
  // 消える件数をここで記録する。0019適用後もこのSELECTは無害に実行され続けるが
  // （image_key列自体が無くなるためcatchして0を返す）、その時点では移行は
  // 既に終わっている。
  // 【031・security-auditor指摘】論理削除済みの投稿は移行対象に含めない
  // （0019のINSERT自体がdeleted_at IS NULLを条件にしたため。ここも揃える）
  console.log("0019（posts.image_keyをpost_imagesへ移す）で移る既存行数を記録します...");
  let postImageMigrationCount;
  try {
    postImageMigrationCount = queryRemoteCount(
      "SELECT COUNT(*) AS count FROM posts WHERE image_key IS NOT NULL AND deleted_at IS NULL",
    );
  } catch {
    // image_key列が既に無い（0019適用済み）。移行は完了しているため0件として扱う
    postImageMigrationCount = 0;
  }
  console.log(
    `image_keyを持つ未削除postsの現在の行数: ${postImageMigrationCount}件。` +
      `0019が未適用ならこの件数がpost_images（position=0）へ移る` +
      `（消えるのではなく形を変えて残る）。この件数をworklog.mdへ写すこと` +
      `〈マージした者の担当〉。docs/tasks/031-multi-image.md 4節）。`,
  );
}

main();

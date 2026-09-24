// リモート D1 への自動マイグレーション（.github/workflows/deploy.yml）の直前に走る前提条件の確認。
// デプロイは無人なので、マイグレーションが「当てる前に人間が数える」ことを求めているものをここで数える
// （該当は `grep -rl "リモートD1へ適用する前に" packages/db/migrations`）。
//
// - 0013: CHECK に違反する行があると、表の作り直しの中間表 `__new_events` が残骸になり、
//   以降の全デプロイが同じ場所で落ち続ける。0 件でなければ止める
// - 0015・0019: 行を消す・移すマイグレーション。件数をこのジョブのログに出して「記録」とする
//   （architecture.md 4節）。止めない
//
// どれも適用済みかを判定せず毎回数える（適用後は常に 0 件か、列が無いので 0 件扱い）
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(repoRoot, "apps", "api");
const wranglerJs = path.join(apiDir, "node_modules", "wrangler", "bin", "wrangler.js");

// 読めない応答を「0 件」と読まない（fail-closed）。唯一の見張りが「読めなかったら異常なし」では意味が無い。
// `SELECT COUNT(*)` は成功すれば必ず 1 行なので、それ以外の形は全部異常にする
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
  // `count: null` は Number(null) === 0 で通ってしまう。COUNT(*) は null を返さないが、
  // MAX()・SUM() に使い回すなら null を弾く一行を足すこと
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

  // 旧 posts.image_width・image_height は NULL 許容で、post_images は NOT NULL。image_key があって
  // 寸法が NULL の行が 1 件でもあると 0019 の INSERT が落ち、先に成功した CREATE TABLE・INDEX が
  // 残骸になって以降のデプロイが落ち続ける（0013 と同じ形）。なので止める
  console.log("0019のNOT NULL列（post_images.width/height）に違反する既存行が無いか確認します...");
  let malformedImageCount;
  try {
    malformedImageCount = queryRemoteCount(
      "SELECT COUNT(*) AS count FROM posts WHERE image_key IS NOT NULL AND deleted_at IS NULL " +
        "AND (image_width IS NULL OR image_height IS NULL)",
    );
  } catch {
    // image_key 列が無い = 0019 適用済み
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

  // 0019 は posts.image_* を post_images へ移してから列を落とす（消えずに形を変えて残る）。
  // 移る件数を記録する。論理削除済みは移さない（0019 の INSERT と条件を揃える）
  console.log("0019（posts.image_keyをpost_imagesへ移す）で移る既存行数を記録します...");
  let postImageMigrationCount;
  try {
    postImageMigrationCount = queryRemoteCount(
      "SELECT COUNT(*) AS count FROM posts WHERE image_key IS NOT NULL AND deleted_at IS NULL",
    );
  } catch {
    // image_key 列が無い = 0019 適用済み
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

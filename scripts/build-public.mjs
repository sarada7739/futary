// apps/landing（素のHTML/CSS）と apps/app の Expo Web エクスポートを、
// apps/api が配信する1つの公開ディレクトリ（apps/api/public）へ合成する
// （docs/tasks/015-landing-page.md。ADR-002: LPのみ別置き、アプリ本体は
// Expo Router 単一コードベース）。
//
// 出力構成:
//   apps/api/public/index.html, style.css, assets/...   <- apps/landing の内容
//     （060: *.html と style.css はコメントを除いて写す。ソースのコメントは残る。assets 等はそのまま）
//   apps/api/public/app/...                              <- apps/app の web export
//
// 053 まではここで `_headers`（CSP 等のレスポンスヘッダ）も書いていたが、旧ホストの
// 301 のために run_worker_first = true にしたところ `_headers` は Worker の応答に
// 効かなくなった（Cloudflare の文書）ので、ヘッダは Worker が付ける
// （apps/api/src/lib/security-headers.ts。CSP の inline script のハッシュは配信する
// HTML から計算）。ここに残っているのは「inline script は想定した本数・全ページ同じ」
// の留め金だけ（Worker は来た HTML の inline script を全部許すので、想定外のものを
// 止めるのはビルドの役目）
//
// apps/app 側は app.json で web.output="static" ・ experiments.baseUrl="/app"
// を設定済みのため、生成される全ページ（今のところ動的セグメントは無い）が
// 実ファイルとして書き出される。/app/* にSPAフォールバックが要らない
// （Cloudflareの静的アセット配信がそのまま `/app/calendar` -> `calendar.html`
// を解決する。既定の html_handling=auto-trailing-slash で足りる）
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 060: 配信する LP の HTML・CSS からコメントを落とす（docs/tasks/060-strip-comments-on-build.md）。
// ソース（apps/landing/）のコメントはタスク番号・内部の文書のパス・内向きの注記を含み、本番に出す
// ものではない。圧縮ツールは入れず、正規表現 1 つずつで足りる範囲に留める:
// - HTML: `<!-- … -->`。条件付きコメント（`<!--[if …]>`）は使っていないので区別しない
// - CSS: `/* … */`。`content:` と `url(` の中に `/*` が無いことをテストで留める（build-public.test.ts T3）
// 除いた後の空行は詰めない（本番の HTML を読んで差分を追えるように）
export function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

export function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const landingDir = path.join(repoRoot, "apps", "landing");
const appDir = path.join(repoRoot, "apps", "app");
const publicDir = path.join(repoRoot, "apps", "api", "public");

// apps/app の実際にビルドされた全ページのHTMLから、インラインscript（src属性の
// 無い<script>）を全部抜き出し、本数と集合を確かめる（053 まではここで SHA256 を
// CSP の script-src に書いていた。今は Worker が配信時に同じ正規表現で取り出して
// ハッシュする。apps/api/src/lib/security-headers.ts）。
// 'unsafe-inline'で一律許可するより狭い（ここに挙がったscript以外のインライン
// scriptは相変わらず拒否される）。
//
// 今日のインラインscriptは2つ（039で1つ増えた）:
// - Expo Routerが埋め込む `globalThis.__EXPO_ROUTER_HYDRATE__=true;`
// - apps/app/app/+html.tsx が置く外観の先読み（localStorageの保存値がホワイトなら
//   hydrate前に<html data-appearance="white">を付ける。039）
// 「増える」のは意図した変更のときだけのはずなので、想定した本数と違えば止める
// （ハッシュが自動で増えると、意図しないインラインscriptが静かに許可される）。
//
// 1ページだけでなく全ページを走査し、script の集合がページ間で一致することまで
// 確認する（security-auditor指摘: 1ファイルだけの実測では、将来Expoがページごとに
// 異なるインラインscriptを吐くようになったとき、そのページだけ静かに
// JSがブロックされる形の壊れ方をする）。正規表現は`[\s\S]*?`にして
// script本文に`<`が含まれても安全に`</script>`まで読む
// （`[^<]*`だと`<`の時点で静かに切り詰められる）
const EXPECTED_INLINE_SCRIPT_COUNT = 2;

function assertInlineScripts(appPublicDir) {
  const htmlFiles = listFilesRecursive(appPublicDir).filter((f) => f.endsWith(".html"));
  if (htmlFiles.length === 0) {
    throw new Error(`${appPublicDir} にHTMLファイルが見つかりません`);
  }

  // src属性を持つ<script>（外部ファイル）は対象外。属性の並びに依存しないよう、
  // 開始タグ全体を取ってからsrcの有無で弾く
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  const scriptSetsByFile = new Map();
  for (const file of htmlFiles) {
    const html = readFileSync(file, "utf8");
    const inline = [];
    for (const match of html.matchAll(scriptPattern)) {
      if (/\bsrc\s*=/.test(match[1])) continue;
      inline.push(match[2]);
    }
    if (inline.length === 0) {
      throw new Error(`${file} にインラインscriptが見つかりません。CSPのハッシュを計算できません`);
    }
    scriptSetsByFile.set(file, inline);
  }

  // ページ間で集合が一致すること（順序は問わない）
  const keyOf = (scripts) => JSON.stringify([...scripts].sort());
  const distinctSets = new Map();
  for (const [file, scripts] of scriptSetsByFile) {
    const key = keyOf(scripts);
    if (!distinctSets.has(key)) distinctSets.set(key, []);
    distinctSets.get(key).push(file);
  }
  if (distinctSets.size > 1) {
    const sample = [...distinctSets.values()].map((files) => files[0]);
    throw new Error(
      `インラインscriptの集合がページによって異なります（${distinctSets.size}種類）。` +
        `CSPのハッシュを決め打てません: ${sample.join(", ")}`,
    );
  }

  const scripts = [...new Set(scriptSetsByFile.values().next().value)];
  if (scripts.length !== EXPECTED_INLINE_SCRIPT_COUNT) {
    throw new Error(
      `インラインscriptが${scripts.length}本あります（想定は${EXPECTED_INLINE_SCRIPT_COUNT}本）。` +
        `意図した変更ならEXPECTED_INLINE_SCRIPT_COUNTを更新すること: ` +
        scripts.map((s) => JSON.stringify(s.slice(0, 60))).join(", "),
    );
  }

  // 記録用（Worker が配信時に計算する値と突き合わせられるように出す）
  return scripts.map((s) => `sha256-${createHash("sha256").update(s, "utf8").digest("base64")}`);
}

function listFilesRecursive(dir) {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    return statSync(fullPath).isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
}

// 015で実際に踏んだ不具合（本番の配布バンドルにhttp://localhost:8787が
// 焼き込まれる）の再発防止。ビルド後のクライアントバンドルを走査する。
//
// 【Rレビュー指摘R-4を受けて2回訂正】
// 1回目（初版）: 「ファイル全体にlocation.originという文字列が存在するか」を
// 見ていたが、判別になっていなかった。`better-auth`・`expo-router`など、
// api-origin.tsとは無関係な依存が同じチャンクファイルの中で
// `location.origin`を参照しているため、api-origin.tsのwindow分岐が
// 畳み込まれて消えていても、ファイル全体で見れば必ず`location.origin`という
// 文字列がどこかに残ってしまい、チェックが常に素通りする（実測で確認: 該当行を
// 削って壊した状態でもビルドが通ってしまっていた）。
//
// 2回目: 「localhost/127.0.0.1という文字列の近傍〈前後300文字〉に
// `typeof window`があるか」に変えたが、これも実測すると誤検知した。
// `better-auth`のURLユーティリティが汎用のホスト判定関数
// （`hostname==="localhost"||hostname.startsWith("127.")`等）を持ち、
// `expo-router`のWebBrowserポリフィルもエラーメッセージ文字列に
// "localhost/https"を含む。どちらもapi-origin.tsとは無関係だが
// `typeof window`を伴わずに"localhost"を含むため、これらが常に
// offenderとして誤検知される（実測で確認: 現状の正しいコードでもビルドが
// 落ちた）。
//
// 修正: 汎用の"localhost"文字列ではなく、getApiOrigin()が実際に埋め込む
// **具体的なリテラル**（`http://localhost:8787`。ポート番号込み）だけを
// 探す。このポート番号を含む文字列は他のライブラリが持つ理由がなく、
// api-origin.tsのフォールバック文字列だけが一致する。見つかった場合のみ、
// その近傍（前後300文字）に`typeof window`というこのガードに固有の
// トークン列が残っているかを確認する。畳み込みが起きると分岐そのもの
// （`typeof window`を含む条件式）が丸ごと消えて文字列だけが残るため、
// 近傍を見ればこの文字列が生きた分岐の中にあるか判別できる。`typeof`と
// `window`の間の空白はJS構文上省略できないため、minifyされても
// `typeof window`という並びは保たれる
// （security-auditor指摘: 実測で見つけたバグは、実測を自動化した時点で
// 初めて塞がる。コメントで「直した」と書くだけでは再発を防げない。
// このチェック自体も、正しいコードで誤検知しないことは実測して確認した。
// 一方、旧コードに戻して実際に例外が飛ぶことは確認できていない
// （Rレビュー指摘: 015当時観測した「本番バンドルにconstとして焼き込まれた」
// 現象は、現在のツールチェーンで複数パターン試しても再現できなかった。
// 発生条件は特定できていない。詳細はartifacts/015/test-results.md参照。
// これは症状ベースの検知〈フォールバックのリテラル文字列がtypeof windowの
// 生きた分岐の外に裸で存在すれば検知する〉であり、元のバグを確実に
// 再現・検知できるという証明ではない）
// FALLBACK_LITERALはapps/app/lib/api-origin.tsのソースから直接読み取る
// （決め打ちで二重管理すると、api-origin.ts側のポートを変えたときに
// このチェックが一致しなくなり、気づかないまま何も検知しなくなる
// 〈落ちる方向ではなく黙って効かなくなる方向〉。Rレビュー指摘）
function readFallbackLiteral() {
  const source = readFileSync(
    path.join(repoRoot, "apps", "app", "lib", "api-origin.ts"),
    "utf8",
  );
  const match = source.match(/return\s+"(http:\/\/localhost:\d+)"/);
  if (!match) {
    throw new Error(
      "apps/app/lib/api-origin.ts からフォールバックURLのリテラルを読み取れません。" +
        "assertNoLocalDevOriginLeakedが検知対象を見失うため、正規表現を見直してください",
    );
  }
  return match[1];
}

function assertNoLocalDevOriginLeaked(appPublicDir) {
  const FALLBACK_LITERAL = readFallbackLiteral();
  const CONTEXT_WINDOW = 300;
  const jsFiles = listFilesRecursive(appPublicDir).filter((f) => f.endsWith(".js"));
  const offenders = [];
  for (const file of jsFiles) {
    const content = readFileSync(file, "utf8");
    let searchFrom = 0;
    let idx;
    while ((idx = content.indexOf(FALLBACK_LITERAL, searchFrom)) !== -1) {
      searchFrom = idx + FALLBACK_LITERAL.length;
      const start = Math.max(0, idx - CONTEXT_WINDOW);
      const end = Math.min(content.length, idx + FALLBACK_LITERAL.length + CONTEXT_WINDOW);
      const context = content.slice(start, end);
      if (!/typeof\s+window/.test(context)) {
        offenders.push({ file, context: context.replace(/\s+/g, " ") });
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `本番の配布バンドルにローカル開発用のオリジンが定数として焼き込まれている疑いがあります:\n` +
        offenders.map((o) => `  ${o.file}\n    近傍: ...${o.context}...`).join("\n") +
        `\napps/app/lib/api-origin.ts のgetApiOrigin()のwindow分岐が畳み込まれていないか確認してください。`,
    );
  }
}

function main() {
  console.log("apps/api/public を作り直します...");
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(publicDir, { recursive: true });

  console.log("apps/landing をコピーします（HTML・CSS はコメントを除いて）...");
  // 060: HTML と CSS は読んで → コメントを除いて → 書く。それ以外は cpSync
  const copyStripped = (name, strip) => {
    writeFileSync(path.join(publicDir, name), strip(readFileSync(path.join(landingDir, name), "utf8")), "utf8");
  };
  copyStripped("index.html", stripHtmlComments);
  // 052: プライバシーポリシー・利用規約。index.html と同じ扱いで写す。
  // Cloudflare の静的アセット配信（html_handling=auto-trailing-slash）が
  // `/privacy` -> `privacy.html` を解決するため、ファイル名は URL に合わせる
  copyStripped("privacy.html", stripHtmlComments);
  copyStripped("terms.html", stripHtmlComments);
  // 048 段階2: 特定商取引法に基づく表記
  copyStripped("tokushoho.html", stripHtmlComments);
  // 054: 技術構成（index.html から移した。フッターからだけ辿れる。sitemap には載せない）
  copyStripped("tech.html", stripHtmlComments);
  // 053: 検索向け。robots.txt は /api/ と /app/ を Disallow、sitemap.xml は / /privacy /terms
  cpSync(path.join(landingDir, "robots.txt"), path.join(publicDir, "robots.txt"));
  cpSync(path.join(landingDir, "sitemap.xml"), path.join(publicDir, "sitemap.xml"));
  copyStripped("style.css", stripCssComments);
  cpSync(path.join(landingDir, "assets"), path.join(publicDir, "assets"), { recursive: true });

  console.log("apps/app を web 向けにエクスポートします...");
  const appPublicDir = path.join(publicDir, "app");
  // node_modules/.bin/expo(.cmd) を経由すると、Windowsでは.cmdをシェル経由でしか
  // 起動できない（packages/db/seed/run.tsのwranglerと同じ理由）。
  // expo本体のbinエントリ（node_modules/expo/bin/cli）をprocess.execPathで
  // 直接起動する
  const expoCli = path.join(appDir, "node_modules", "expo", "bin", "cli");
  execFileSync(
    process.execPath,
    [expoCli, "export", "--platform", "web", "--output-dir", appPublicDir],
    {
      cwd: appDir,
      stdio: "inherit",
      // apps/app/.env の EXPO_PUBLIC_API_ORIGIN（ローカル開発用に
      // http://localhost:8787 を指す）を空文字で上書きする。
      //
      // 【実測の経緯（Rレビュー指摘R-2・R-3を受けて訂正）】
      // 015で見つけた不具合は「本番の配布バンドルにhttp://localhost:8787が
      // 定数として焼き込まれる」というものだった。原因の候補は2つあった:
      //   (1) .envのEXPO_PUBLIC_API_ORIGINがビルド時に文字列置換される
      //   (2) apps/app/lib/api-origin.tsがモジュール直下の定数式で、
      //       typeof windowがビルド時に固定値へ畳み込まれる
      // apiOrigin を getApiOrigin() という関数に切り出したところ（(2)の対策）、
      // このEXPO_PUBLIC_API_ORIGIN上書きを外した状態で再実測しても、
      // クライアントバンドルには定数として焼き込まれず、実行時に
      // window.location.originを正しく参照する形が残ることを確認した。
      // つまり(2)の対策だけで再発は防げており、この空文字上書きは
      // 必須ではなくなっている可能性が高い。
      // それでも残す理由: (1)の経路（Metroの環境変数インライン化が
      // 将来のバージョンで挙動を変え、process.env.EXPO_PUBLIC_API_ORIGINが
      // 再びクライアントバンドルへ文字列として現れるようになる可能性）を
      // 塞いでおくための多層防御。空文字にする（キー自体を消すとExpo自身が
      // .envを再読み込みして上書きしてしまう。dotenvは既存のキーを
      // 上書きしないため、空文字を明示することで.envの値を確実に
      // 無効化できる）。apps/app/lib/api-origin.tsのgetApiOrigin()は
      // `if (process.env.EXPO_PUBLIC_API_ORIGIN) return ...`という形のため、
      // 空文字はfalsyとして扱われwindow.location.originへ進む
      env: { ...process.env, EXPO_PUBLIC_API_ORIGIN: "" },
    },
  );

  console.log("本番バンドルにローカル開発用オリジンが残っていないか確認します...");
  assertNoLocalDevOriginLeaked(appPublicDir);

  console.log("インラインscriptの本数と集合を確かめます...");
  const inlineScriptHashes = assertInlineScripts(appPublicDir);
  console.log(`  inline script: ${inlineScriptHashes.join(" / ")}`);

  console.log("完了: apps/api/public");
}

// 060: テスト（apps/api/test/build-public.test.ts）が strip* を import できるように、入口のときだけ走らせる。
// Windows の process.argv[1] は `C:\\…` 形式なので、両方を fileURLToPath / path.resolve で揃えて比べる
const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main();

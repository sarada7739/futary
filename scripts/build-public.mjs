// apps/landing（素のHTML/CSS）と apps/app の Expo Web エクスポートを、
// apps/api が配信する1つの公開ディレクトリ（apps/api/public）へ合成する
// （docs/tasks/015-landing-page.md。ADR-002: LPのみ別置き、アプリ本体は
// Expo Router 単一コードベース）。
//
// 出力構成:
//   apps/api/public/index.html, style.css, assets/...   <- apps/landing の内容
//   apps/api/public/app/...                              <- apps/app の web export
//   apps/api/public/_headers                             <- CSP等のレスポンスヘッダ
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const landingDir = path.join(repoRoot, "apps", "landing");
const appDir = path.join(repoRoot, "apps", "app");
const publicDir = path.join(repoRoot, "apps", "api", "public");

// R2の署名付きURLは実際には単一ホスト（https://<accountId>.r2.cloudflarestorage.com。
// apps/api/src/lib/r2-signed-url.ts）を指す。CSPで `https://*.r2.cloudflarestorage.com`
// のようにワイルドカードで許可すると、XSSが成立した場合の持ち出し先として
// 攻撃者自身のR2バケット（誰でも作れる）まで許可することになる
// （security-auditor指摘）。R2_ACCOUNT_IDはCIでは環境変数から、ローカルでは
// apps/api/.dev.varsから読む。どちらにも無ければビルドを失敗させる
// （fail-closed。apps/api/src/auth.tsのTRUSTED_ORIGINSワイルドカード禁止と同じ姿勢）
function readR2AccountId() {
  if (process.env.R2_ACCOUNT_ID) return process.env.R2_ACCOUNT_ID;
  const devVarsPath = path.join(repoRoot, "apps", "api", ".dev.vars");
  try {
    const devVars = readFileSync(devVarsPath, "utf8");
    const match = devVars.match(/^R2_ACCOUNT_ID=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // .dev.varsが無い環境（CI等）はR2_ACCOUNT_ID環境変数側に頼る
  }
  throw new Error(
    "R2_ACCOUNT_IDを取得できません。環境変数R2_ACCOUNT_IDを設定するか、" +
      "apps/api/.dev.varsにR2_ACCOUNT_ID=<値>を設定してください。" +
      "CSPのimg-src/connect-srcにワイルドカードで許可すると、XSS成立時に" +
      "攻撃者自身のR2バケットへの持ち出しを許すことになるため、決め打ちにしない",
  );
}

// apps/app の実際にビルドされた全ページのHTMLから、Expo Routerが埋め込む
// インラインscript（globalThis.__EXPO_ROUTER_HYDRATE__=true;）を抜き出し、
// そのSHA256ハッシュをCSPのscript-srcに使う。'unsafe-inline'で一律許可する
// より狭い（このスクリプト以外のインラインscriptは相変わらず拒否される）。
// 1ページだけでなく全ページを走査し、内容が一致することまで確認する
// （security-auditor指摘: 1ファイルだけの実測では、将来Expoがページごとに
// 異なるインラインscriptを吐くようになったとき、そのページだけ静かに
// JSがブロックされる形の壊れ方をする）。正規表現は`[\s\S]*?`にして
// script本文に`<`が含まれても安全に`</script>`まで読む
// （`[^<]*`だと`<`の時点で静かに切り詰められる）
function extractInlineScriptHash(appPublicDir) {
  const htmlFiles = listFilesRecursive(appPublicDir).filter((f) => f.endsWith(".html"));
  if (htmlFiles.length === 0) {
    throw new Error(`${appPublicDir} にHTMLファイルが見つかりません`);
  }

  const scriptsByFile = new Map();
  for (const file of htmlFiles) {
    const html = readFileSync(file, "utf8");
    const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    if (!match) {
      throw new Error(`${file} にインラインscriptが見つかりません。CSPのハッシュを計算できません`);
    }
    scriptsByFile.set(file, match[1]);
  }

  const distinctScripts = new Set(scriptsByFile.values());
  if (distinctScripts.size > 1) {
    const sample = [...scriptsByFile.entries()].slice(0, 3);
    throw new Error(
      `インラインscriptの内容がページによって異なります（${distinctScripts.size}種類）。` +
        `CSPのハッシュを1つに決め打てません: ${sample.map(([f]) => f).join(", ")}`,
    );
  }

  const hash = createHash("sha256").update([...distinctScripts][0], "utf8").digest("base64");
  return `'sha256-${hash}'`;
}

function listFilesRecursive(dir) {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    return statSync(fullPath).isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
}

// CSP・その他のセキュリティヘッダ（security-requirements.md 7節「CSPは
// ランディングページとWebアプリに設定する」）。Cloudflare Workers Assetsの
// _headersファイルは静的アセットのレスポンスにのみ適用される
// （/api/*はWorkerが直接応答するため対象外。JSONレスポンスにCSPは意味を持たない）。
//
// img-src/connect-srcの内訳（security-auditor指摘を反映）:
// - R2の署名付きURL（画像の取得・アップロード）は https://<r2host> のみ許可
// - blob: は画像投稿パイプラインに必須。expo-image-picker（Web実装）と
//   expo-image-manipulatorがどちらもURL.createObjectURL()を使うため、
//   これが無いと本番ビルドで画像投稿・プロフィール画像設定が全て失敗する
//   （apps/app/app/compose.tsx・apps/app/lib/image.ts）
// - Googleのプロフィール画像ホスト（lh3.googleusercontent.com）は
//   apps/api/src/lib/r2-signed-url.tsのresolveUserImageが、自前アップロード
//   でない場合はGoogle OAuthの画像URLをそのまま返す仕様のため必要
//   （packages/ui/src/components/avatar.tsx）
//
// frame-ancestors 'none' はmetaタグでは効かないため、_headersで設定する
// 意味がある（クリックジャッキング対策）。form-actionはdefault-srcに
// フォールバックしない独立ディレクティブのため明示する。
// Strict-Transport-Securityは016で独自ドメインに切り替えたときの
// SSLストリップ対策（*.workers.devはHSTS preload済みだが、それに頼らない）
function buildCsp(inlineScriptHash, r2AccountId) {
  const r2Host = `https://${r2AccountId}.r2.cloudflarestorage.com`;
  return (
    "default-src 'self'; " +
    `script-src 'self' ${inlineScriptHash}; ` +
    "style-src 'self' 'unsafe-inline'; " +
    `img-src 'self' data: blob: ${r2Host} https://lh3.googleusercontent.com; ` +
    "font-src 'self'; " +
    `connect-src 'self' blob: ${r2Host}; ` +
    "frame-ancestors 'none'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
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

  console.log("apps/landing をコピーします...");
  cpSync(path.join(landingDir, "index.html"), path.join(publicDir, "index.html"));
  cpSync(path.join(landingDir, "style.css"), path.join(publicDir, "style.css"));
  cpSync(path.join(landingDir, "assets"), path.join(publicDir, "assets"), { recursive: true });

  const r2AccountId = readR2AccountId();

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

  console.log("CSPのインラインscriptハッシュを計算します...");
  const inlineScriptHash = extractInlineScriptHash(appPublicDir);

  console.log("_headers を書きます...");
  const csp = buildCsp(inlineScriptHash, r2AccountId);
  const headersFile =
    `/*\n` +
    `  Content-Security-Policy: ${csp}\n` +
    `  X-Content-Type-Options: nosniff\n` +
    `  Referrer-Policy: strict-origin-when-cross-origin\n` +
    `  Strict-Transport-Security: max-age=31536000; includeSubDomains\n`;
  writeFileSync(path.join(publicDir, "_headers"), headersFile, "utf8");

  console.log("完了: apps/api/public");
}

main();

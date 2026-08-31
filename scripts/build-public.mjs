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
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const landingDir = path.join(repoRoot, "apps", "landing");
const appDir = path.join(repoRoot, "apps", "app");
const publicDir = path.join(repoRoot, "apps", "api", "public");

// apps/app の実際にビルドされた index.html から、Expo Routerが埋め込む
// 唯一のインラインscript（globalThis.__EXPO_ROUTER_HYDRATE__=true;）を
// 抜き出し、そのSHA256ハッシュをCSPのscript-srcに使う。'unsafe-inline'で
// 一律許可するより狭い（このスクリプト以外のインラインscriptは相変わらず拒否される）。
// 全ページで同一内容であることを確認済み（build-public.mjs実行時のログ参照）。
// Expoのバージョンが変わってテンプレートの中身が変わればハッシュも変わるため、
// 決め打ちにせずビルドのたびに実測する
function extractInlineScriptHash(indexHtmlPath) {
  const html = readFileSync(indexHtmlPath, "utf8");
  const match = html.match(/<script type="module">([^<]*)<\/script>/);
  if (!match) {
    throw new Error(`${indexHtmlPath} にインラインscriptが見つかりません。CSPのハッシュを計算できません`);
  }
  const hash = createHash("sha256").update(match[1], "utf8").digest("base64");
  return `'sha256-${hash}'`;
}

// CSP・その他のセキュリティヘッダ（security-requirements.md 7節「CSPは
// ランディングページとWebアプリに設定する」）。Cloudflare Workers Assetsの
// _headersファイルは静的アセットのレスポンスにのみ適用される
// （/api/*はWorkerが直接応答するため対象外。JSONレスポンスにCSPは意味を持たない）。
//
// img-src/connect-srcにR2のS3互換APIオリジンを含める（署名付きURLで
// 画像を直接取得・アップロードするため。architecture.md 6節）。
// frame-ancestors 'none' はmetaタグでは効かないため、_headersで設定する
// 意味がある（クリックジャッキング対策）
function buildCsp(inlineScriptHash) {
  return (
    "default-src 'self'; " +
    `script-src 'self' ${inlineScriptHash}; ` +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https://*.r2.cloudflarestorage.com; " +
    "font-src 'self'; " +
    "connect-src 'self' https://*.r2.cloudflarestorage.com; " +
    "frame-ancestors 'none'; " +
    "object-src 'none'; " +
    "base-uri 'self'"
  );
}

function main() {
  console.log("apps/api/public を作り直します...");
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(publicDir, { recursive: true });

  console.log("apps/landing をコピーします...");
  cpSync(path.join(landingDir, "index.html"), path.join(publicDir, "index.html"));
  cpSync(path.join(landingDir, "style.css"), path.join(publicDir, "style.css"));
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
      // http://localhost:8787 を指す）をビルドに含めない。Expoは
      // EXPO_PUBLIC_* をビルド時にバンドルへ焼き込むため、これを外さないと
      // 本番ビルドがローカル開発用のAPIオリジンを指したまま固定されてしまう
      // （実測: CSPのconnect-srcが本番オリジン以外を許可していないため
      // localhost:8787への接続がブロックされ、デモが「いま見られません」に
      // なることで発覚した）。
      // 空文字にする（キー自体を消すとExpo自身が.envを再読み込みして
      // 上書きしてしまう。dotenvは既存のキーを上書きしないため、空文字を
      // 明示することで.envの値を確実に無効化できる）。空文字なら
      // apps/app/lib/api-origin.ts の `??` は通過せずそのまま空文字になり、
      // `${apiOrigin}/api` が "/api" というオリジン相対パスになって
      // 同一オリジンで正しく解決される
      env: { ...process.env, EXPO_PUBLIC_API_ORIGIN: "" },
    },
  );

  console.log("CSPのインラインscriptハッシュを計算します...");
  const inlineScriptHash = extractInlineScriptHash(path.join(appPublicDir, "index.html"));

  console.log("_headers を書きます...");
  const csp = buildCsp(inlineScriptHash);
  const headersFile = `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`;
  writeFileSync(path.join(publicDir, "_headers"), headersFile, "utf8");

  console.log("完了: apps/api/public");
}

main();

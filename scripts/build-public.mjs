// apps/landing（素の HTML/CSS）と apps/app の Expo Web エクスポートを、apps/api が配信する
// 1 つの公開ディレクトリ（apps/api/public）へ合成する（ADR-002）。
//
// 出力構成:
//   apps/api/public/index.html, style.css, assets/...   <- apps/landing（HTML・CSS はコメントを除く。060）
//   apps/api/public/app/...                              <- apps/app の web export
//
// レスポンスヘッダ（CSP 等）は Worker が付ける（run_worker_first では `_headers` が効かない。
// apps/api/src/lib/security-headers.ts）。Worker は来た HTML の inline script を全部許すので、
// 想定外の inline script を止めるのはこのビルドの役目。
//
// apps/app は web.output="static"・experiments.baseUrl="/app" で全ページが実ファイルになるので、
// /app/* に SPA フォールバックは要らない（html_handling=auto-trailing-slash が解決する）
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 配信する LP からコメントを落とす（ソースのコメントは内部の注記を含む。060）。
// 圧縮ツールは入れず正規表現 1 つずつ。条件付きコメントは使っていない。CSS の `content:` と
// `url(` に `/*` が無いことはテストで留める（build-public.test.ts）。空行は詰めない
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

// 全ページの inline script（src の無い <script>）を集め、本数とページ間の集合の一致を確かめる。
// 増えるのは意図した変更のときだけのはずなので、数が違えば止める（自動で許すと、意図しない
// inline script が静かに通る）。1 ページだけ見ると、ページごとに違う script が出たとき
// そのページだけ JS が止まる形で壊れるので全ページを見る。
// 今は 2 本: Expo Router の `globalThis.__EXPO_ROUTER_HYDRATE__=true;` と、+html.tsx の外観の先読み（039）。
// 正規表現は `[\s\S]*?`（`[^<]*` だと本文の `<` で切れる）
const EXPECTED_INLINE_SCRIPT_COUNT = 2;

function assertInlineScripts(appPublicDir) {
  const htmlFiles = listFilesRecursive(appPublicDir).filter((f) => f.endsWith(".html"));
  if (htmlFiles.length === 0) {
    throw new Error(`${appPublicDir} にHTMLファイルが見つかりません`);
  }

  // 属性の並びに依存しないよう、開始タグ全体を取ってから src の有無で弾く
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

  // 記録用（Worker が配信時に計算する値と突き合わせられる）
  return scripts.map((s) => `sha256-${createHash("sha256").update(s, "utf8").digest("base64")}`);
}

function listFilesRecursive(dir) {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    return statSync(fullPath).isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
}

// 本番の配布バンドルに開発用のオリジン（http://localhost:8787）が定数として焼き込まれていないか（015）。
// 汎用の "localhost" や "location.origin" は他のライブラリも持つので判別にならない。
// getApiOrigin() のフォールバックの具体的なリテラル（ポート込み）だけを探し、その近傍（前後 300 文字）に
// `typeof window` が残っているかを見る（畳み込まれると分岐が消えて文字列だけが残る。`typeof` と
// `window` の間の空白は minify でも消えない）。症状で検知する形で、元の不具合の再現はできていない
// （artifacts/015/test-results.md）。
// リテラルは api-origin.ts から読む（決め打ちだとポートを変えたとき黙って効かなくなる）
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
  const copyStripped = (name, strip) => {
    writeFileSync(path.join(publicDir, name), strip(readFileSync(path.join(landingDir, name), "utf8")), "utf8");
  };
  // ファイル名は URL に合わせる（html_handling が `/privacy` -> `privacy.html` を解決する）
  copyStripped("index.html", stripHtmlComments);
  copyStripped("privacy.html", stripHtmlComments);
  copyStripped("terms.html", stripHtmlComments);
  copyStripped("tokushoho.html", stripHtmlComments);
  copyStripped("tech.html", stripHtmlComments);
  cpSync(path.join(landingDir, "robots.txt"), path.join(publicDir, "robots.txt"));
  cpSync(path.join(landingDir, "sitemap.xml"), path.join(publicDir, "sitemap.xml"));
  copyStripped("style.css", stripCssComments);
  cpSync(path.join(landingDir, "assets"), path.join(publicDir, "assets"), { recursive: true });

  console.log("apps/app を web 向けにエクスポートします...");
  const appPublicDir = path.join(publicDir, "app");
  // Windows では node_modules/.bin/expo.cmd をシェル経由でしか起動できないので、
  // expo 本体の bin を process.execPath で直接起動する
  const expoCli = path.join(appDir, "node_modules", "expo", "bin", "cli");
  execFileSync(
    process.execPath,
    [expoCli, "export", "--platform", "web", "--output-dir", appPublicDir],
    {
      cwd: appDir,
      stdio: "inherit",
      // apps/app/.env の EXPO_PUBLIC_API_ORIGIN（開発用に localhost を指す）を空文字で上書きする。
      // getApiOrigin() が関数になっているので無くても焼き込まれないが、Metro の環境変数の
      // インライン化が将来変わったときのための多層防御。キーを消すと Expo が .env を読み直すので
      // 空文字（falsy）を明示する
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

// テストが strip* を import できるよう、入口のときだけ走らせる。
// Windows の process.argv[1] は `C:\…` 形式なので、両方を path に揃えて比べる
const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main();

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// ペアのデータ・利用者ごとのデータを読む問い合わせは、クライアント側で
// queryKeyに閲覧者の識別子（viewerKey。apps/app/lib/viewer-key.ts）を
// 含めなければならない。含めないと、リロード無しで本物のログイン⇄ゲスト⇄
// 未認証を切り替えたときに、直前の別人のキャッシュが一瞬そのまま画面に
// 出る（security-requirements.md T9。共有端末では実質的な情報漏洩になる。
// 実機で発生した不具合）。
//
// 【設計の経緯（5回、同じ側で穴が見つかった）】
// このテストは何度も作り直された: 手で並べた一覧 → readProcedureの走査 →
// 近傍N文字 → AST2段 → orpc識別子起点 → import文の形。だが5回とも
// 「orpcへどうやって辿り着いたか」を留め金にしていた。R曰く「orpcを配って
// いるモジュールを字面で名指しする限り、名指しの外側はいくらでも作れる
// （開いた集合）」。実際、名前空間import・再エクスポート・オプショナル
// チェイン・型アサーション等、6通り以上の逃げ道が見つかり続けた。
//
// 【最終形（Aの判断）: 留め金の位置を変える】
// 「orpcへどうやって辿り着いたか」を追うのをやめ、「TanStack Query の
// キャッシュのキーを取るAPI」という**閉じた集合**（ライブラリの関数名。
// 増えるとしたらライブラリのバージョンアップ時で、そのときは差分に出る）
// を起点にする。キャッシュ枠を作る・読む・書く・無効化する処理は必ず
// useQuery/useInfiniteQuery/queryClient.setQueryData等のどれかを通る。
// options（queryOptions()の戻り値等）をどう手に入れたかに関係なく、
// 呼び出しの「名前」だけで機械的に見つかる。Rが実測: apps/app配下の
// useQuery/useInfiniteQuery 15件、呼び出し式の中にviewerKeyがあるもの
// 15件・無いもの0件（このAPI名を起点にする形は既に閉じている）。
//
// queryKeyの中身をどう構文的に辿るか（変数へのspread・短縮記法1段辿り等）
// という「精密な判定」自体は従来のまま残す（メッセージがqueryKeyの中身
// まで具体的に示せるため。Aの指示で「捨てない」）。変わったのは
// 「どの呼び出しをこの精密な判定にかけるか」を数える側だけである。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(testDir, "..");
const repoRoot = path.resolve(appDir, "../..");

// 【Rレビュー指摘】ディレクトリ名だけで一致させると、`apps/app/app/test/`
// のような「たまたま同じ名前のネストしたディレクトリ」まで除外して
// しまう（実測時点でそのようなディレクトリは無く実害は無いが、次に
// 誰かが作ったら黙って視界の外になる）。除外は「apps/app直下のこの
// パス1つ」に限定する（絶対パスの完全一致だけで比較し、名前の再帰的な
// 一致はしない）
const EXCLUDED_TOP_LEVEL_DIR_NAMES = [
  "node_modules", // 依存パッケージ。自分のソースではない
  ".expo", // Expoのキャッシュ・生成物（.gitignore済み）
  ".claude", // エージェント設定。実行されるコードではない
  "dist", // ビルド成果物（.gitignore済み）
  "web-build", // ビルド成果物（.gitignore済み）
  "test", // このテストファイル自身を含む。TanStack Queryの実使用ではなく、
  // モック・フィクスチャ・説明用の使い捨てスニペットを含むため対象外
  "public", // 静的配信ファイル（HTML等）。TS/TSXのソースではない
  "assets", // 画像等のバイナリ資産
];
const EXCLUDED_ABSOLUTE_DIRS = new Set(EXCLUDED_TOP_LEVEL_DIR_NAMES.map((name) => path.join(appDir, name)));

function listFilesExcluding(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_ABSOLUTE_DIRS.has(fullPath)) return [];
      return listFilesExcluding(fullPath);
    }
    return [fullPath];
  });
}

// 【守る範囲（conventions.md 6節「検証の範囲から外したものは、結果に書く」）】
// この網が走査するのは`apps/app`配下全体から、上のEXCLUDED_ABSOLUTE_DIRS
// （`apps/app`直下のこの8パスだけ）を除いたもの。`apps/app`の外
// （他のアプリ・パッケージ。例えば`apps/api`や`packages/*`）は範囲外。
// TanStack Queryのキャッシュキー生成をこのアプリの外（別パッケージ）で
// 組み立てる形も範囲外（いまはそのような書き方が無いため対応しない）
function listAppSourceFiles(): string[] {
  return listFilesExcluding(appDir).filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith(".d.ts"));
}

// 【Rレビュー指摘・小さいもの】失敗メッセージに文字位置（例: 1940）を
// そのまま出していたが、行番号ではなく文字位置だったため、次に踏む人が
// ファイルを開いてすぐ辿れなかった。1-indexedの行:桁に変換する
function formatLocation(sourceFile: ts.SourceFile, pos: number): string {
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, pos);
  return `${line + 1}:${character + 1}`;
}

function parseSource(file: string, contentOverride?: string): ts.SourceFile {
  const content = contentOverride ?? readFileSync(file, "utf8");
  return ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

// nodeの部分木のどこかに、名前がnameと一致する識別子があるかを見る
function containsIdentifierNamed(node: ts.Node, name: string): boolean {
  let found = false;
  function visit(n: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}

// nameという名前の変数を、fromNodeを含む直近のスコープ（関数・ファイル）
// の中から1つだけ探す。fail-closedのため、見つからなければnullを返す
// （それ以上広いスコープや複数候補の曖昧な解決はしない。分割代入等の
// 束縛は対象外——動的な実キーを扱う正当な理由がある箇所は
// viewer-key-coverage-ignoreコメントで別途免除する）
function findVariableInitializerInScope(fromNode: ts.Node, name: string): ts.Node | null {
  let scope: ts.Node = fromNode.getSourceFile();
  let current: ts.Node = fromNode;
  while (current.parent) {
    if (ts.isFunctionLike(current.parent)) {
      scope = current.parent;
      break;
    }
    current = current.parent;
  }
  let found: ts.Node | null = null;
  function visit(n: ts.Node): void {
    if (found) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      found = n.initializer;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(scope);
  return found;
}

// useQuery/useInfiniteQuery等のoptionsオブジェクトから`queryKey`
// プロパティの初期化式を取り出す。ES2015の短縮記法
// （`useQuery({ ...options, queryKey })`）にも対応する
function queryKeyInitializer(objectLiteral: ts.ObjectLiteralExpression): ts.Node | null {
  const prop = objectLiteral.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "queryKey",
  );
  if (prop) return prop.initializer;

  // 【Rレビュー指摘・Aの判断「短縮記法を許す」】
  // `const queryKey = [...]; useQuery({ ...options, queryKey })`という
  // 短縮記法（ES2015のオブジェクト省略記法）だと、queryKeyプロパティは
  // PropertyAssignmentではなくShorthandPropertyAssignmentになり、上の
  // findは常にnullを返していた。「viewerKeyが確認できません」という
  // メッセージは、実際には2行上にあるのに嘘をつくことになる（Rの指摘。
  // 一番悪い壊れ方）。長い式を変数に出すのは普通のリファクタであり、
  // 禁じて正しいコードを規約違反にすべきではない（Aの判断）。同じ
  // スコープの変数宣言を1段だけ辿る（それ以上は追わない。辿れなければ
  // fail-closedのままnullを返す）
  const shorthand = objectLiteral.properties.find(
    (p): p is ts.ShorthandPropertyAssignment => ts.isShorthandPropertyAssignment(p) && p.name.text === "queryKey",
  );
  if (!shorthand) return null;
  return findVariableInitializerInScope(shorthand, "queryKey");
}

// 【Aの判断・R実測】TanStack Queryの「キャッシュのキーを取るAPI」を
// 列挙する。ライブラリの関数・メソッド名という閉じた集合（増えるとしたら
// ライブラリのバージョンアップ時で、そのときは差分に出る）。
//
// このうちuseQuery/useInfiniteQuery/setQueryData/getQueryDataは
// 「1つの値を読む・書く」操作のため、queryKeyがviewerKeyを含まないと
// 別人のキャッシュを読む・別人のキャッシュへ書く事故になりうる（T9）。
// 厳密にviewerKeyを要求する
const EXACT_KEY_REQUIRED_METHODS = new Set(["useQuery", "useInfiniteQuery", "setQueryData", "getQueryData"]);

// invalidateQueries/cancelQueries/removeQueries/setQueriesData/
// getQueriesDataは、既定（exact指定なし）では前方一致のフィルタとして
// 効く。短いキー（例: `orpc.me.get.key()`）で複数のviewerKey付き
// キャッシュ枠をまとめて対象にすることは設計上正しい——無効化・
// キャンセル・削除・複数件の一括更新（updater関数で各自の既存データを
// 変換するだけ）は「値を返す」操作ではないため、対象が複数のviewerKeyに
// またがっても別人のデータを覗き見ることにはならない（timeline.tsxの
// コメント参照）。このためviewerKeyを要求しない。
// 【範囲外】`exact: true`を明示して呼ぶケースは今のコードベースに無く
// 扱わない（発生したら見直す。conventions.md 6節）
const PREFIX_MATCH_METHODS = new Set([
  "invalidateQueries",
  "cancelQueries",
  "removeQueries",
  "setQueriesData",
  "getQueriesData",
]);

const ALL_CACHE_KEY_METHODS = new Set([...EXACT_KEY_REQUIRED_METHODS, ...PREFIX_MATCH_METHODS]);

// 呼び出しの callee がキャッシュキーAPIの名前と一致するか見る。
// `useQuery(...)`のような裸の関数呼び出しと、`queryClient.setQueryData(...)`
// のようなメンバー呼び出しの両方を受け付ける。受け手（`queryClient`という
// 変数名等）は問わない——ライブラリのメソッド名という閉じた集合で
// 判定するため、型チェッカーによる受け手の型検証は不要（Aの判断。遅く、
// いま閉じたい穴は型の追跡ではないため）
function cacheKeyMethodNameOf(call: ts.CallExpression): string | null {
  if (ts.isIdentifier(call.expression) && ALL_CACHE_KEY_METHODS.has(call.expression.text)) {
    return call.expression.text;
  }
  if (ts.isPropertyAccessExpression(call.expression) && ALL_CACHE_KEY_METHODS.has(call.expression.name.text)) {
    return call.expression.name.text;
  }
  return null;
}

// useQuery/useInfiniteQueryの第1引数（オプションオブジェクト）を取り出す。
// オブジェクトリテラルを直接渡す形と、変数に受けてから渡す形
// （1段だけ辿る）の両方に対応する
function resolveOptionsObjectArgument(call: ts.CallExpression): ts.ObjectLiteralExpression | null {
  const arg = call.arguments[0];
  if (!arg) return null;
  if (ts.isObjectLiteralExpression(arg)) return arg;
  if (ts.isIdentifier(arg)) {
    const init = findVariableInitializerInScope(call, arg.text);
    if (init && ts.isObjectLiteralExpression(init)) return init;
  }
  return null;
}

// setQueryData/getQueryDataの第1引数（queryKeyそのもの）を取り出す。
// 識別子1つだけの場合は1段だけ変数を辿る（それ以上は追わない。
// 分割代入等で辿れない場合はnull＝fail-closed）
function resolveDirectKeyArgument(call: ts.CallExpression): ts.Node | null {
  const arg = call.arguments[0];
  if (!arg) return null;
  if (ts.isIdentifier(arg)) return findVariableInitializerInScope(call, arg.text);
  return arg;
}

// 呼び出し1件について、精密な判定にかけるべき「queryKeyを表すノード」を
// 返す。PREFIX_MATCH_METHODSはそもそも呼ばれない（呼び出し側で分岐する）
function resolveExactKeyNode(methodName: string, call: ts.CallExpression): ts.Node | null {
  if (methodName === "useQuery" || methodName === "useInfiniteQuery") {
    const objectLiteral = resolveOptionsObjectArgument(call);
    return objectLiteral ? queryKeyInitializer(objectLiteral) : null;
  }
  if (methodName === "setQueryData" || methodName === "getQueryData") {
    return resolveDirectKeyArgument(call);
  }
  return null;
}

// 「-- 理由」まで要求する（規約として書くなら、規約が守られていることも
// 検査する）。ESLintのdisableコメントと同じ「慣用・grep可能・diffに出る」
// 目印
const IGNORE_COMMENT_PATTERN = /viewer-key-coverage-ignore\s+--\s+\S/;

// 呼び出し行の直前に連続する`//`コメント行をさかのぼって全て結合する
// （複数行のコメントで理由を書いても検出できるように）
function precedingCommentBlock(content: string, index: number): string {
  const lines: string[] = [];
  let lineEnd = content.lastIndexOf("\n", index - 1) + 1;
  for (;;) {
    const lineStart = content.lastIndexOf("\n", lineEnd - 2) + 1;
    const line = content.slice(lineStart, lineEnd > 0 ? lineEnd - 1 : lineEnd);
    if (!/^\s*\/\//.test(line)) break;
    lines.unshift(line);
    lineEnd = lineStart;
    if (lineStart === 0) break;
  }
  return lines.join("\n");
}

function hasIgnoreComment(content: string, index: number): boolean {
  return IGNORE_COMMENT_PATTERN.test(precedingCommentBlock(content, index));
}

type CacheKeySiteStatus = "exact-ok" | "exact-ignored" | "exact-missing" | "prefix-exempt";

interface CacheKeySite {
  file: string;
  location: string;
  methodName: string;
  status: CacheKeySiteStatus;
  // フォールトインジェクション用: 判定対象になったノードのソース範囲
  // （見つからなかった場合、または対象外の場合はnull）
  checkRange: [number, number] | null;
}

// ファイル1つから、キャッシュのキーを取る呼び出しを全て見つけ、それぞれを
// 分類する。PREFIX_MATCH_METHODSは構造的に免除（viewerKey不要）、
// EXACT_KEY_REQUIRED_METHODSはqueryKeyの中身を精密に判定し、
// viewerKeyが無ければ直前のignoreコメントの有無で赤/免除を分ける
function scanCacheKeySites(file: string, content: string, sourceFile: ts.SourceFile): CacheKeySite[] {
  const sites: CacheKeySite[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const methodName = cacheKeyMethodNameOf(node);
      if (methodName) {
        const location = formatLocation(sourceFile, node.getStart(sourceFile));
        if (PREFIX_MATCH_METHODS.has(methodName)) {
          sites.push({ file, location, methodName, status: "prefix-exempt", checkRange: null });
        } else {
          const keyNode = resolveExactKeyNode(methodName, node);
          const checkRange: [number, number] | null = keyNode
            ? [keyNode.getStart(sourceFile), keyNode.getEnd()]
            : null;
          if (keyNode && containsIdentifierNamed(keyNode, "viewerKey")) {
            sites.push({ file, location, methodName, status: "exact-ok", checkRange });
          } else if (hasIgnoreComment(content, node.getStart(sourceFile))) {
            sites.push({ file, location, methodName, status: "exact-ignored", checkRange });
          } else {
            sites.push({ file, location, methodName, status: "exact-missing", checkRange });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return sites;
}

describe("TanStack Queryのキャッシュのキーを取る呼び出しは、viewerKeyを含むか明示的に免除されている（T9）", () => {
  // 検出ロジック自体の健全性: 列挙そのものが空にならないことを固定する
  // （ライブラリのAPI名という閉じた集合。増減があれば診断で気づける）
  it("キャッシュのキーを取るAPIの一覧が想定どおりである（検出ロジック自体の健全性）", () => {
    expect([...ALL_CACHE_KEY_METHODS].sort()).toEqual(
      [
        "useQuery",
        "useInfiniteQuery",
        "setQueryData",
        "getQueryData",
        "invalidateQueries",
        "cancelQueries",
        "removeQueries",
        "setQueriesData",
        "getQueriesData",
      ].sort(),
    );
  });

  function scanRealFiles(): CacheKeySite[] {
    const files = listAppSourceFiles();
    const sites: CacheKeySite[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const sourceFile = parseSource(file, content);
      sites.push(...scanCacheKeySites(file, content, sourceFile));
    }
    return sites;
  }

  // 検出ロジック自体の健全性: メソッドごとに実際の呼び出しが最低1件は
  // 見つかることを固定する。0件のまま「対象が無いので緑」というテストの
  // 見せかけの安全を防ぐ（#245「逃げ道の側を数える」と同じ考え方）
  it("9種のAPI全てについて、実際の呼び出しが最低1件は見つかる（検出ロジック自体の健全性）", () => {
    const sites = scanRealFiles();
    const foundMethods = new Set(sites.map((s) => s.methodName));
    for (const method of ALL_CACHE_KEY_METHODS) {
      expect(foundMethods.has(method), `${method}の呼び出しが1件も見つかりません`).toBe(true);
    }
  });

  // 【受け入れの形】キャッシュのキーを取る呼び出しのうち、精密な判定の
  // 対象になっていないもの（viewerKeyが無く、免除もされていない）が
  // 0件であることを固定する
  it("viewerKeyが無く、免除もされていない呼び出しは0件である", () => {
    const missing = scanRealFiles().filter((s) => s.status === "exact-missing");
    expect(
      missing,
      missing
        .map(
          (s) =>
            `${path.relative(repoRoot, s.file)}:${s.location} の ${s.methodName}(...) にviewerKeyが確認できません`,
        )
        .join("\n"),
    ).toEqual([]);
  });

  // 【受け入れの形】免除は理由つきで一覧に載り、載っていない免除は赤。
  // 免除箇所そのものを名指しで固定する（合計数だけを見ると、免除が
  // 増えても対象が同じだけ減れば埋め合わされて気づけないため）
  it("viewer-key-coverage-ignoreで免除されているのは想定どおり1箇所だけである", () => {
    const ignored = scanRealFiles().filter((s) => s.status === "exact-ignored");
    expect(ignored.map((s) => `${path.relative(repoRoot, s.file).replace(/\\/g, "/")}:${s.location}`)).toEqual([
      "apps/app/app/(tabs)/timeline.tsx:74:59",
    ]);
  });

  // 対になる確認: 免除コメントに「-- 理由」が無ければ免除として扱われない
  // （規約として書くなら、規約が守られていることも検査する）
  it("「-- 理由」の無いviewer-key-coverage-ignoreは免除として扱われない", () => {
    const content =
      'import { useQuery } from "@tanstack/react-query";\n' +
      "// viewer-key-coverage-ignore\n" +
      'useQuery({ queryKey: ["x"], queryFn: async () => 1 });\n';
    const sourceFile = parseSource("no-reason.tsx", content);
    const sites = scanCacheKeySites("no-reason.tsx", content, sourceFile);
    expect(sites.some((s) => s.status === "exact-missing")).toBe(true);
  });

  // 【受け入れの形】Rが開けた逃げ道（名前空間import・orpc自身のエイリアス・
  // namespace段のエイリアス・ブラケット記法等）を色々混ぜても、
  // useQuery側の数えは外れない——という頑健性を、実際にこれらの書き方を
  // 使ったuseQuery呼び出しで確かめる。以前はorpcの参照経路そのものを
  // 追っていたためこれらが逃げ道になったが、いまは呼び出しの「名前」
  // （useQuery）だけを起点にするため、内部でoptionsをどう組み立てたかに
  // 関係なく検出できる
  describe("orpcの取得経路をどう書いても、useQuery呼び出し自体は検出される（検出ロジック自体の健全性）", () => {
    const cases: Array<[string, string]> = [
      [
        "名前空間import経由",
        'import * as orpcModule from "../../lib/orpc";\n' +
          "const options = orpcModule.orpc.couple.get.queryOptions();\n" +
          "const query = useQuery({ ...options, queryKey: options.queryKey });\n",
      ],
      [
        "ブラケット記法",
        'import { orpc } from "../../lib/orpc";\n' +
          'const options = orpc["couple"]["get"].queryOptions();\n' +
          "const query = useQuery({ ...options, queryKey: options.queryKey });\n",
      ],
      [
        "orpc自身を変数へ代入してから辿る",
        'import { orpc } from "../../lib/orpc";\n' +
          "const o = orpc;\n" +
          "const options = o.couple.get.queryOptions();\n" +
          "const query = useQuery({ ...options, queryKey: options.queryKey });\n",
      ],
      // 【留め金を移す前の最後の3つの逃げ道（Rが実測。PR #255）】
      // 再エクスポート・`export *`・拡張子つきimportは、いずれも「orpcを
      // どうやって取得したか」を追う旧仕組みでは検出できなかった
      // （うち1つはAが名指しした`export { orpc } from ...`そのもの）。
      // 新仕組みはorpcの取得経路を一切見ないため、これらは構造的に
      // 無関係になる——それを実際に確かめる
      [
        "再エクスポート経由（export { orpc } from \"./orpc\" を別ファイルに置き、そこから import * as m）",
        'import * as m from "./reexported-orpc";\n' +
          "const options = m.orpc.couple.get.queryOptions();\n" +
          "const query = useQuery({ ...options, queryKey: options.queryKey });\n",
      ],
      [
        'export * from "./orpc" 経由',
        'import * as m from "./star-exported-orpc";\n' +
          "const options = m.orpc.couple.get.queryOptions();\n" +
          "const query = useQuery({ ...options, queryKey: options.queryKey });\n",
      ],
      [
        "拡張子つきimport（import * as m from \"../../lib/orpc.js\"）",
        'import * as m from "../../lib/orpc.js";\n' +
          "const options = m.orpc.couple.get.queryOptions();\n" +
          "const query = useQuery({ ...options, queryKey: options.queryKey });\n",
      ],
    ];

    it.each(cases)("%s でも、viewerKeyが無ければ検出される", (_label, code) => {
      const sourceFile = parseSource("escape-hatch.tsx", code);
      const sites = scanCacheKeySites("escape-hatch.tsx", code, sourceFile);
      const useQuerySites = sites.filter((s) => s.methodName === "useQuery");
      expect(useQuerySites.length).toBeGreaterThan(0);
      expect(useQuerySites.every((s) => s.status === "exact-missing")).toBe(true);
    });

    it.each(cases)("%s で、viewerKeyがあれば緑になる", (_label, code) => {
      const withViewerKey = code.replace("queryKey: options.queryKey", "queryKey: [...options.queryKey, viewerKey]");
      expect(withViewerKey).not.toBe(code);
      const sourceFile = parseSource("escape-hatch.tsx", withViewerKey);
      const sites = scanCacheKeySites("escape-hatch.tsx", withViewerKey, sourceFile);
      const useQuerySites = sites.filter((s) => s.methodName === "useQuery");
      expect(useQuerySites.length).toBeGreaterThan(0);
      expect(useQuerySites.every((s) => s.status === "exact-ok")).toBe(true);
    });
  });

  // 【Rの受け入れ条件「短縮記法の正当な書き方が緑になる」】
  it("queryKeyを変数に出す短縮記法（stats.tsxで実際に指摘された形）は、viewerKeyがあれば緑になる", () => {
    const code =
      'import { orpc } from "../../lib/orpc";\n' +
      "function StatsCard() {\n" +
      "  const viewerKey = useViewerQueryKey();\n" +
      "  const queryKey = [...orpc.stats.get.queryOptions().queryKey, viewerKey];\n" +
      "  const query = useQuery({ ...orpc.stats.get.queryOptions(), queryKey });\n" +
      "  return query;\n" +
      "}\n";
    const sourceFile = parseSource("shorthand.tsx", code);
    const sites = scanCacheKeySites("shorthand.tsx", code, sourceFile).filter((s) => s.methodName === "useQuery");
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => s.status === "exact-ok")).toBe(true);
  });

  // 対になる確認: 短縮記法でも、実際にviewerKeyが無ければきちんと赤になる
  it("同じ短縮記法でも、viewerKeyが無ければ赤のまま（fail-closed）", () => {
    const code =
      'import { orpc } from "../../lib/orpc";\n' +
      "function StatsCard() {\n" +
      "  const queryKey = [...orpc.stats.get.queryOptions().queryKey];\n" +
      "  const query = useQuery({ ...orpc.stats.get.queryOptions(), queryKey });\n" +
      "  return query;\n" +
      "}\n";
    const sourceFile = parseSource("shorthand.tsx", code);
    const sites = scanCacheKeySites("shorthand.tsx", code, sourceFile).filter((s) => s.methodName === "useQuery");
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => s.status === "exact-missing")).toBe(true);
  });

  // 対になる確認: queryKey変数そのものが見つからない（1段辿っても
  // 解決できない）場合はfail-closedのまま赤になる
  it("queryKey変数が見つからない場合はfail-closedのまま赤になる", () => {
    const code =
      'import { orpc } from "../../lib/orpc";\n' +
      "function StatsCard() {\n" +
      "  const query = useQuery({ ...orpc.stats.get.queryOptions(), queryKey });\n" +
      "  return query;\n" +
      "}\n";
    const sourceFile = parseSource("shorthand.tsx", code);
    const sites = scanCacheKeySites("shorthand.tsx", code, sourceFile).filter((s) => s.methodName === "useQuery");
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => s.status === "exact-missing")).toBe(true);
  });

  // setQueryData/getQueryDataも同じ精密さで判定されることを確かめる
  // （#179のpendingInviteQueryKeyがまさにこの形。orpcを経由しない）
  it("setQueryData/getQueryDataは、queryKey引数（またはそれを1段だけ辿った変数）にviewerKeyがあれば緑になる", () => {
    const code =
      "function usePendingInvite(viewerKey) {\n" +
      "  const key = pendingInviteQueryKey(viewerKey);\n" +
      "  queryClient.setQueryData(key, invite);\n" +
      "  return queryClient.getQueryData(pendingInviteQueryKey(viewerKey));\n" +
      "}\n";
    const sourceFile = parseSource("direct-key.tsx", code);
    const sites = scanCacheKeySites("direct-key.tsx", code, sourceFile);
    const relevant = sites.filter((s) => s.methodName === "setQueryData" || s.methodName === "getQueryData");
    expect(relevant.length).toBe(2);
    expect(relevant.every((s) => s.status === "exact-ok")).toBe(true);
  });

  it("setQueryData/getQueryDataは、viewerKeyが無ければ赤になる（免除コメントが無い限り）", () => {
    const code = "queryClient.setQueryData(fixedKey, data);\n";
    const sourceFile = parseSource("direct-key.tsx", code);
    const sites = scanCacheKeySites("direct-key.tsx", code, sourceFile);
    expect(sites.some((s) => s.methodName === "setQueryData" && s.status === "exact-missing")).toBe(true);
  });

  // invalidateQueries等（PREFIX_MATCH_METHODS）は、viewerKeyが無くても
  // 構造的に免除される（前方一致で複数のviewerKey付き枠をまとめて
  // 対象にすることが設計上正しいため）ことを確かめる
  it("invalidateQueries/cancelQueries/removeQueries/setQueriesData/getQueriesDataはviewerKeyが無くても免除される", () => {
    const code =
      "queryClient.invalidateQueries({ queryKey: orpc.me.get.key() });\n" +
      "queryClient.cancelQueries({ queryKey: orpc.post.list.key() });\n" +
      "queryClient.removeQueries({ queryKey: orpc.me.get.key() });\n" +
      "queryClient.setQueriesData({ queryKey: orpc.post.list.key() }, updater);\n" +
      "queryClient.getQueriesData({ queryKey: orpc.post.list.key() });\n";
    const sourceFile = parseSource("prefix.tsx", code);
    const sites = scanCacheKeySites("prefix.tsx", code, sourceFile);
    expect(sites.length).toBe(5);
    expect(sites.every((s) => s.status === "prefix-exempt")).toBe(true);
  });

  // 【Rレビュー指摘R-2の実証】判定ロジック自体が「効いていること」を、
  // 実際にviewerKeyを1つ外した状態を作って確かめる（#246「測定を足したら、
  // 両側から当てる」）。実ファイルの中でexact-okになっている全ての
  // checkRangeについて、そこだけを狙って"viewerKey"を書き換え、(1)その
  // 箇所自身がexact-missing/exact-ignoredのどちらかに変わること
  // （＝status: exact-okのまま緑を保たないこと）(2)同じファイル内の
  // 他の呼び出しが巻き添えで壊れないことを確認する
  it("実ファイルのexact-okな呼び出しは、そのqueryKeyからviewerKeyを外すと緑を保たない", () => {
    const files = listAppSourceFiles();
    let injectionCount = 0;

    for (const file of files) {
      const originalContent = readFileSync(file, "utf8");
      const baselineSourceFile = parseSource(file, originalContent);
      const baseline = scanCacheKeySites(file, originalContent, baselineSourceFile).filter(
        (s) => s.status === "exact-ok" && s.checkRange,
      );

      for (const site of baseline) {
        const [start, end] = site.checkRange as [number, number];
        const mutated =
          originalContent.slice(0, start) +
          originalContent.slice(start, end).replaceAll("viewerKey", "viewerKeyRemovedForFaultInjection") +
          originalContent.slice(end);
        expect(mutated, `${path.relative(repoRoot, file)}:${site.location}: 置換が実際に効いていない`).not.toBe(
          originalContent,
        );

        const mutatedSourceFile = parseSource(file, mutated);
        const afterSites = scanCacheKeySites(file, mutated, mutatedSourceFile);
        const sameLocationAfter = afterSites.filter(
          (s) => s.methodName === site.methodName && s.location === site.location,
        );
        expect(
          sameLocationAfter.some((s) => s.status !== "exact-ok"),
          `${path.relative(repoRoot, file)}:${site.location} (${site.methodName}) はviewerKeyを外しても緑のまま`,
        ).toBe(true);

        injectionCount += 1;
      }
    }

    expect(injectionCount).toBeGreaterThan(0);
  });
});

// 【Rレビュー指摘】ディレクトリ名だけの除外だと`apps/app/app/test/`の
// ような同名のネストしたディレクトリまで巻き込む。除外は`apps/app`直下の
// 1パスだけに限定したことを、実際に`apps/app/app/test/`へファイルを
// 置いて確かめる（作業後は必ず削除する）
describe("走査対象は apps/app 配下全体（除外は apps/app 直下の1パスだけ）", () => {
  it("apps/app/test は除外されるが、apps/app/app/test は除外されない", () => {
    expect(EXCLUDED_ABSOLUTE_DIRS.has(path.join(appDir, "test"))).toBe(true);
    expect(EXCLUDED_ABSOLUTE_DIRS.has(path.join(appDir, "app", "test"))).toBe(false);
  });

  it("apps/app/app/test/ に置いた画面は実際に走査対象に入る", () => {
    const probeDir = path.join(appDir, "app", "test");
    const probeFile = path.join(probeDir, "__viewer_key_coverage_probe__.tsx");
    const probeDirAlreadyExisted = existsSync(probeDir);
    if (!probeDirAlreadyExisted) mkdirSync(probeDir, { recursive: true });
    writeFileSync(probeFile, "export const probe = 1;\n");
    try {
      expect(listAppSourceFiles()).toContain(probeFile);
    } finally {
      rmSync(probeFile);
      if (!probeDirAlreadyExisted) rmSync(probeDir, { recursive: true });
    }
  });

  it("apps/app/lib 配下のファイルは走査対象に含まれる（app/・componentsだけの列挙だった旧版の穴）", () => {
    const relative = listAppSourceFiles().map((f) => path.relative(appDir, f).replace(/\\/g, "/"));
    expect(relative).toEqual(expect.arrayContaining(["lib/orpc.ts"]));
  });

  it("除外したディレクトリ（apps/app/test・node_modules等）は走査対象に含まれない", () => {
    const relative = listAppSourceFiles().map((f) => path.relative(appDir, f).replace(/\\/g, "/"));
    for (const excluded of ["test/", "node_modules/", "assets/", "public/"]) {
      expect(relative.some((f) => f.startsWith(excluded)), `${excluded}配下が走査対象に含まれている`).toBe(false);
    }
  });
});

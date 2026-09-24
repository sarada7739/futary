import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// ペアのデータ・利用者ごとのデータを読む問い合わせは、queryKey に閲覧者の識別子
// （viewerKey。apps/app/lib/viewer-key.ts）を含めなければならない。含めないと、リロード
// 無しでログイン⇄ゲスト⇄未認証を切り替えたときに、直前の別人のキャッシュが一瞬画面に出る
// （security-requirements.md T9。共有端末では情報漏洩になる）。
//
// 起点は「orpc へどう辿り着いたか」ではなく「TanStack Query のキャッシュのキーを取る API」
// という閉じた集合（ライブラリの関数名。増えるのはバージョンアップ時で、差分に出る）。
// キャッシュ枠を作る・読む・書く・無効化する処理は必ずこのどれかを通るので、options を
// どう手に入れたかに関係なく、呼び出しの名前だけで機械的に見つかる。
// queryKey の中身を構文的に辿る精密な判定は、失敗メッセージで queryKey の中身まで示せる
// ように残している

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(testDir, "..");
const repoRoot = path.resolve(appDir, "../..");

// 除外は apps/app 直下のこのパスだけ（絶対パスの完全一致）。名前だけで一致させると
// apps/app/app/test/ のような同名のネストしたディレクトリまで黙って視界の外になる
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
// 走査するのは apps/app 配下から EXCLUDED_ABSOLUTE_DIRS を除いたもの。apps/app の外
// （apps/api・packages/*）と、キャッシュキーを別パッケージで組み立てる形は範囲外
function listAppSourceFiles(): string[] {
  return listFilesExcluding(appDir).filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith(".d.ts"));
}

// 失敗メッセージは文字位置ではなく 1 始まりの行:桁で出す（開いてすぐ辿れるように）
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

// name という変数を、fromNode を含む直近のスコープ（関数・ファイル）から 1 つだけ探す。
// 見つからなければ null（fail-closed。広いスコープや分割代入は辿らない。動的な実キーを
// 扱う正当な箇所は viewer-key-coverage-ignore で免除する）
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

  // 短縮記法（`const queryKey = [...]; useQuery({ ...options, queryKey })`）は
  // ShorthandPropertyAssignment になり、上の find では拾えない。拾えないと「viewerKey が
  // 確認できません」と嘘のメッセージになるので、同じスコープの変数宣言を 1 段だけ辿る
  // （辿れなければ fail-closed のまま null）
  const shorthand = objectLiteral.properties.find(
    (p): p is ts.ShorthandPropertyAssignment => ts.isShorthandPropertyAssignment(p) && p.name.text === "queryKey",
  );
  if (!shorthand) return null;
  return findVariableInitializerInScope(shorthand, "queryKey");
}

// 閉じた集合を手で写さず、出どころ（ライブラリの実際のモジュール）から引く。手で写すと
// useSuspenseQuery・useQueries・ensureQueryData・fetchQuery・getQueryState 等が漏れる。
// ts.createProgram は使わず、モジュールの値そのものを読む
import * as ReactQueryModule from "@tanstack/react-query";

// ライブラリの公開面をそのまま列挙する（手で書かない）。バージョンを
// 上げてこの一覧が変わったら、下のtoEqualが赤くなり気づける
const RAW_REACT_QUERY_EXPORTS = Object.keys(ReactQueryModule).sort();
const RAW_QUERY_CLIENT_METHODS = Object.getOwnPropertyNames(ReactQueryModule.QueryClient.prototype)
  .filter((name) => name !== "constructor")
  .sort();

interface Classification {
  // "exact": 1件の値を読む・書くため、viewerKeyを厳密に要求する
  // "prefix": 既定で前方一致のフィルタとして効くため、viewerKeyを要求しない
  // "conditional": 前方一致だから安全ではなく、使い方に条件がついた安全。条件が崩れたら
  //   exact と同じ扱い。CONDITIONAL_METHOD_CHECKS に対応する条件関数を持つ
  // "excluded": データそのものを読み書きしない（件数・設定・ライフサイクル等）ため対象外
  bucket: "exact" | "prefix" | "conditional" | "excluded";
  reason: string;
}

// react-queryパッケージの公開exportの分類。フック以外（クラス・
// コンポーネント・内部ユーティリティ）は、実装を読んで「呼び出し側で
// queryKeyを直接渡すか」で判断した
const REACT_QUERY_EXPORT_CLASSIFICATION: Record<string, Classification> = {
  useQuery: { bucket: "exact", reason: "1件のクエリを読むフックそのもの" },
  useInfiniteQuery: { bucket: "exact", reason: "1件の無限クエリを読むフックそのもの" },
  useSuspenseQuery: { bucket: "exact", reason: "useQueryのSuspense版。差し替え先で意味は同じ" },
  useSuspenseInfiniteQuery: { bucket: "exact", reason: "useInfiniteQueryのSuspense版" },
  useQueries: { bucket: "exact", reason: "複数クエリをまとめて読む。各要素が個別のqueryKeyを持つ" },
  useSuspenseQueries: { bucket: "exact", reason: "useQueriesのSuspense版" },
  usePrefetchQuery: { bucket: "exact", reason: "先読みしてキャッシュへ書く。viewerKey無しで書くと別人の枠に置かれる" },
  usePrefetchInfiniteQuery: { bucket: "exact", reason: "usePrefetchQueryの無限版" },
  useMutation: { bucket: "excluded", reason: "mutationKeyはこの規約の対象外（既存のmutationOptions扱いと同じ）" },
  useMutationState: { bucket: "excluded", reason: "mutationKeyを対象にする。ミューテーションはこの規約の対象外" },
  mutationOptions: { bucket: "excluded", reason: "ミューテーション用のヘルパー。queryKeyを扱わない" },
  useIsFetching: { bucket: "excluded", reason: "件数（number）を返すだけ。データそのものは返さない" },
  useIsMutating: { bucket: "excluded", reason: "件数（number）を返すだけ。データそのものは返さない" },
  useIsRestoring: { bucket: "excluded", reason: "永続化からの復元中かを示す真偽値。キーを取らない" },
  useQueryClient: { bucket: "excluded", reason: "QueryClientインスタンス自体を返すだけ。そこから呼ぶ各メソッドは別途このテストの対象" },
  useQueryErrorResetBoundary: { bucket: "excluded", reason: "エラー境界のリセット関数を返すだけ。キーを取らない" },
  QueryClient: { bucket: "excluded", reason: "クラス自体（コンストラクタ）。newで作るだけで、appでは1箇所のみ（lib/query.ts）" },
  QueryClientProvider: { bucket: "excluded", reason: "Reactコンポーネント。propsにqueryKeyを取らない" },
  QueryClientContext: { bucket: "excluded", reason: "Reactコンテキストオブジェクト" },
  QueryErrorResetBoundary: { bucket: "excluded", reason: "Reactコンポーネント" },
  IsRestoringProvider: { bucket: "excluded", reason: "Reactコンテキストプロバイダ" },
  HydrationBoundary: { bucket: "excluded", reason: "SSR用のReactコンポーネント。このアプリ（Expo/RN）はSSRを使わない" },
  dehydrate: { bucket: "excluded", reason: "SSR用のシリアライズ関数。このアプリはSSRを使わない（実測: 未使用）" },
  dehydrateQuery: { bucket: "excluded", reason: "同上（1件版）" },
  hydrate: { bucket: "excluded", reason: "SSR用の復元関数。このアプリはSSRを使わない（実測: 未使用）" },
  defaultShouldDehydrateQuery: { bucket: "excluded", reason: "SSRのdehydrate対象を選ぶ既定関数。未使用" },
  defaultShouldDehydrateMutation: { bucket: "excluded", reason: "同上（ミューテーション版）" },
  Query: { bucket: "excluded", reason: "内部クラス。フック経由でのみ使う（実測: appから直接newしていない）" },
  QueryCache: { bucket: "excluded", reason: "内部クラス。appから直接newしていない（実測）" },
  QueryObserver: { bucket: "excluded", reason: "内部クラス（useQueryの内部実装）。appから直接newしていない（実測）" },
  QueriesObserver: { bucket: "excluded", reason: "内部クラス（useQueriesの内部実装）。appから直接newしていない（実測）" },
  InfiniteQueryObserver: { bucket: "excluded", reason: "内部クラス（useInfiniteQueryの内部実装）。appから直接newしていない（実測）" },
  Mutation: { bucket: "excluded", reason: "内部クラス。appから直接newしていない（実測）" },
  MutationCache: { bucket: "excluded", reason: "内部クラス。appから直接newしていない（実測）" },
  MutationObserver: { bucket: "excluded", reason: "内部クラス（useMutationの内部実装）。appから直接newしていない（実測）" },
  CancelledError: { bucket: "excluded", reason: "エラークラス。キーを持たない" },
  isCancelledError: { bucket: "excluded", reason: "型ガード関数。データを読み書きしない" },
  isServer: { bucket: "excluded", reason: "真偽値の定数" },
  skipToken: { bucket: "excluded", reason: "クエリを一時的に無効化する目印の値。データを読み書きしない" },
  keepPreviousData: { bucket: "excluded", reason: "placeholderDataの既定戦略。データを読み書きしない" },
  noop: { bucket: "excluded", reason: "内部の空関数" },
  hashKey: { bucket: "excluded", reason: "queryKeyを文字列へハッシュ化するだけ。データそのものは返さない" },
  partialMatchKey: { bucket: "excluded", reason: "内部の前方一致判定ヘルパー。データを返さない" },
  matchQuery: { bucket: "excluded", reason: "内部のフィルタ判定ヘルパー。データを返さない" },
  matchMutation: { bucket: "excluded", reason: "同上（ミューテーション版）" },
  replaceEqualDeep: { bucket: "excluded", reason: "内部の構造共有ユーティリティ" },
  shouldThrowError: { bucket: "excluded", reason: "内部のエラー判定ヘルパー" },
  focusManager: { bucket: "excluded", reason: "ウィンドウフォーカス監視の内部シングルトン" },
  onlineManager: { bucket: "excluded", reason: "オンライン状態監視の内部シングルトン" },
  notifyManager: { bucket: "excluded", reason: "内部の通知バッチ処理シングルトン" },
  environmentManager: { bucket: "excluded", reason: "内部のSSR/CSR環境判定シングルトン" },
  timeoutManager: { bucket: "excluded", reason: "内部のタイマー管理シングルトン" },
  defaultScheduler: { bucket: "excluded", reason: "内部のスケジューラ関数" },
  dataTagSymbol: { bucket: "excluded", reason: "型付け用のシンボル定数" },
  dataTagErrorSymbol: { bucket: "excluded", reason: "同上（エラー型用）" },
  unsetMarker: { bucket: "excluded", reason: "内部の未設定を示すシンボル定数" },
  queryOptions: { bucket: "excluded", reason: "queryOptionsオブジェクトを組み立てるだけのヘルパー。appはoRPC側のqueryOptions()を使い、これを直接呼んでいない（実測）。戻り値がuseQuery等へ渡ればそちら側で検査される" },
  infiniteQueryOptions: { bucket: "excluded", reason: "同上（無限版）。未使用（実測）" },
  experimental_streamedQuery: { bucket: "excluded", reason: "streamingのqueryFnを組み立てるヘルパー。未使用（実測）" },
};

// QueryClientインスタンスメソッドの分類。実装（node_modules内の
// queryClient.js）を実際に読み、戻り値がキャッシュ済みデータそのものを
// 返すかどうかで判断した
const QUERY_CLIENT_METHOD_CLASSIFICATION: Record<string, Classification> = {
  setQueryData: { bucket: "exact", reason: "指定したqueryKeyへ値を書く。viewerKey無しだと別人の枠へ書く事故になる" },
  getQueryData: { bucket: "exact", reason: "指定したqueryKeyの値をそのまま返す" },
  getQueryState: { bucket: "exact", reason: "実装を読んで確認: .state（dataを含む）をそのまま返す" },
  ensureQueryData: { bucket: "exact", reason: "実装を読んで確認: キャッシュ済みデータ、無ければ取得して返す" },
  ensureInfiniteQueryData: { bucket: "exact", reason: "ensureQueryDataの無限版" },
  fetchQuery: { bucket: "exact", reason: "実装を読んで確認: 取得したデータをそのまま返す（非推奨だが現行版に存在）" },
  fetchInfiniteQuery: { bucket: "exact", reason: "fetchQueryの無限版" },
  prefetchQuery: { bucket: "exact", reason: "fetchQueryを呼びキャッシュへ書く。viewerKey無しで書くと別人の枠に置かれる" },
  prefetchInfiniteQuery: { bucket: "exact", reason: "prefetchQueryの無限版" },
  query: { bucket: "exact", reason: "実装を読んで確認: fetchQuery/prefetchQueryの後継（新API）。取得したデータをそのまま返す" },
  infiniteQuery: { bucket: "exact", reason: "queryの無限版（fetchInfiniteQueryの後継）" },
  invalidateQueries: { bucket: "prefix", reason: "前方一致のフィルタで無効化するだけ。値を返さない" },
  cancelQueries: { bucket: "prefix", reason: "前方一致のフィルタで進行中の取得を止めるだけ。値を返さない" },
  removeQueries: { bucket: "prefix", reason: "前方一致のフィルタでキャッシュから削除するだけ。値を返さない" },
  refetchQueries: { bucket: "prefix", reason: "前方一致のフィルタで再取得を発火するだけ。呼び出し側へ値を返さない" },
  resetQueries: { bucket: "prefix", reason: "前方一致のフィルタで初期状態へ戻すだけ。値を返さない" },
  // 前方一致だから安全ではなく、使い方に条件がついた安全。条件が崩れると別人の枠を覗く・
  // 別人の枠へ書く事故になりうる（T9）。条件は CONDITIONAL_METHOD_CHECKS で検査する
  setQueriesData: {
    bucket: "conditional",
    reason:
      "実装のfunctionalUpdateは、updaterが関数ならそれを呼ぶが、関数でなければ値をそのまま使う。値をそのまま渡すと、前方一致で選ばれた全員の枠へ同じ値を注入する。条件: updaterが、既存データを変換する関数であること。" +
      "【範囲外・Aの指摘】検査できるのは「関数式であること」までで、中身が既存データを使っているか（引数を無視して別のデータを返していないか）は見ていない。`(old) => 誰かのデータ`は関数の形をした注入であり、この条件を満たしてしまう（Rが実測）。ただし他人のデータを注入するには先に他人のデータを手に入れる必要があり、その入口（getQueriesDataや単一キーの読み）は別途塞いでいるため、いまは届かない。厳しすぎる側（関数を変数に出して渡す形も赤になる）に倒すほうが、緩いより良いと判断し、直さない",
  },
  getQueriesData: {
    bucket: "conditional",
    reason:
      "実装はqueryCache.findAll(filters).map(({queryKey,state}) => [queryKey, state.data])で、前方一致に一致した全員のstate.dataをそのまま配列に入れて返す。呼び出し側がそれを変数へ入れる・返す・添字で読む等すれば、別人のデータを読むことになる。条件: 返り値を消費しないこと",
  },
  isFetching: { bucket: "excluded", reason: "実装を読んで確認: 件数（.length）を返すだけ" },
  isMutating: { bucket: "excluded", reason: "実装を読んで確認: 件数（.length）を返すだけ" },
  clear: { bucket: "excluded", reason: "引数を取らず、キャッシュ全体を消すだけ" },
  mount: { bucket: "excluded", reason: "ライフサイクル。引数を取らない" },
  unmount: { bucket: "excluded", reason: "同上" },
  resumePausedMutations: { bucket: "excluded", reason: "引数を取らない" },
  getDefaultOptions: { bucket: "excluded", reason: "全体既定のオプションを返すだけ。クエリ固有のデータではない" },
  setDefaultOptions: { bucket: "excluded", reason: "全体既定のオプションを設定するだけ" },
  getQueryDefaults: { bucket: "excluded", reason: "実装を読んで確認: queryKeyに紐づく既定オプションを返すだけで、実際のデータではない" },
  setQueryDefaults: { bucket: "excluded", reason: "同上（設定側）" },
  getMutationDefaults: { bucket: "excluded", reason: "mutationKeyに紐づく既定オプション。ミューテーションはこの規約の対象外" },
  setMutationDefaults: { bucket: "excluded", reason: "同上（設定側）" },
  defaultQueryOptions: { bucket: "excluded", reason: "内部用のオプション合成ヘルパー。appから直接呼んでいない（実測）" },
  defaultMutationOptions: { bucket: "excluded", reason: "同上（ミューテーション版）" },
  getQueryCache: { bucket: "excluded", reason: "QueryCacheオブジェクト自体を返すだけ。中のfind/findAllは別クラスのAPIで、appでは使っていない（実測）。使われたら要見直し（範囲外）" },
  getMutationCache: { bucket: "excluded", reason: "MutationCacheオブジェクト自体を返すだけ。appでは使っていない（実測）" },
};

function bucketedNames(classification: Record<string, Classification>, bucket: Classification["bucket"]): string[] {
  return Object.entries(classification)
    .filter(([, c]) => c.bucket === bucket)
    .map(([name]) => name);
}

const EXACT_KEY_REQUIRED_METHODS = new Set([
  ...bucketedNames(REACT_QUERY_EXPORT_CLASSIFICATION, "exact"),
  ...bucketedNames(QUERY_CLIENT_METHOD_CLASSIFICATION, "exact"),
]);
const PREFIX_MATCH_METHODS = new Set([
  ...bucketedNames(REACT_QUERY_EXPORT_CLASSIFICATION, "prefix"),
  ...bucketedNames(QUERY_CLIENT_METHOD_CLASSIFICATION, "prefix"),
]);
const CONDITIONAL_METHODS = new Set([
  ...bucketedNames(REACT_QUERY_EXPORT_CLASSIFICATION, "conditional"),
  ...bucketedNames(QUERY_CLIENT_METHOD_CLASSIFICATION, "conditional"),
]);
const ALL_CACHE_KEY_METHODS = new Set([...EXACT_KEY_REQUIRED_METHODS, ...PREFIX_MATCH_METHODS, ...CONDITIONAL_METHODS]);

// getQueriesData・setQueriesData の条件を機械的に検査する（T9。conventions.md
// 「条件は検査する。書くだけにしない」）

// getQueriesDataの戻り値が「消費されていない」か（呼び出しが式文として
// だけ存在し、結果をどこにも渡していないか）を見る。変数へ代入・
// return・添字/プロパティアクセス・他の呼び出しへの引数渡し等、
// 消費する形は全て「消費されている」とみなす（fail-closed。この呼び出し
// 自体が式文として使われている、というただ1つの形だけを安全とする）
function isGetQueriesDataResultUnconsumed(call: ts.CallExpression): boolean {
  return ts.isExpressionStatement(call.parent);
}

// setQueriesDataの第2引数（updater）が関数式・アロー関数であるかを見る。
// 値をそのまま渡す形は、前方一致で選ばれた全員の枠へ同じ値を書き込む
// ことになるため安全ではない
function isSetQueriesDataUpdaterFunction(call: ts.CallExpression): boolean {
  const updater = call.arguments[1];
  return !!updater && (ts.isArrowFunction(updater) || ts.isFunctionExpression(updater));
}

const CONDITIONAL_METHOD_CHECKS: Record<string, (call: ts.CallExpression) => boolean> = {
  getQueriesData: isGetQueriesDataResultUnconsumed,
  setQueriesData: isSetQueriesDataUpdaterFunction,
};

// conditional な 2 つが崩れているのは viewerKey の有無ではなく条件そのもの。「viewerKey が
// 確認できません」と出すと、読んだ人が viewerKey を足しても直らない。API ごとに何が壊れて
// いるかを言う
function describeMissingReason(methodName: string): string {
  if (methodName === "getQueriesData") {
    return "戻り値を消費しています。このAPIは他人のデータを返すため、戻り値を使うならviewerKeyの話ではなく別の設計が要ります（consumeしない形にするか、viewer-key-coverage-ignoreで理由を明記してください）";
  }
  if (methodName === "setQueriesData") {
    return "updaterが関数式ではありません（第2引数が関数式であることが条件です。値やオブジェクトリテラルを直接渡す形は、前方一致で選ばれた全員の枠へ同じ値を書き込みます）";
  }
  return "viewerKeyが確認できません";
}

// useQueries/useSuspenseQueriesは`{ queries: [...] }`という配列形を取り、
// 要素ごとに個別のqueryKeyを持つ（他のフックとは引数の形が違う）
const QUERIES_ARRAY_SHAPE_METHODS = new Set(["useQueries", "useSuspenseQueries"]);
// setQueryData/getQueryData/getQueryStateは第1引数がqueryKeyそのもの
const DIRECT_KEY_SHAPE_METHODS = new Set(["setQueryData", "getQueryData", "getQueryState"]);
// それ以外のEXACT_KEY_REQUIRED_METHODSは、第1引数が`{ queryKey, ... }`と
// いうオプションオブジェクト（useQueryと同じ形）

// 呼び出しの callee がキャッシュキー API の名前と一致するか見る。裸の関数呼び出しと
// メンバー呼び出しの両方を受け付ける。受け手（変数名等）は問わない（メソッド名という
// 閉じた集合で判定するので、型チェッカーでの受け手の検証はしない）
function cacheKeyMethodNameOf(call: ts.CallExpression): string | null {
  if (ts.isIdentifier(call.expression) && ALL_CACHE_KEY_METHODS.has(call.expression.text)) {
    return call.expression.text;
  }
  if (ts.isPropertyAccessExpression(call.expression) && ALL_CACHE_KEY_METHODS.has(call.expression.name.text)) {
    return call.expression.name.text;
  }
  return null;
}

// ブラケット記法（`queryClient["setQueryData"](...)`）は ElementAccessExpression なので
// 上の cacheKeyMethodNameOf に一致しない。入口はドット記法に限り、ブラケット記法は
// 違反として別に検知する
function bracketCacheKeyMethodNameOf(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (
    ts.isElementAccessExpression(callee) &&
    ts.isStringLiteralLike(callee.argumentExpression) &&
    ALL_CACHE_KEY_METHODS.has(callee.argumentExpression.text)
  ) {
    return callee.argumentExpression.text;
  }
  return null;
}

// オプションオブジェクト形の第1引数を取り出す。オブジェクトリテラルを
// 直接渡す形と、変数に受けてから渡す形（1段だけ辿る）の両方に対応する
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

// 直接キー形（setQueryData/getQueryData/getQueryState）の第1引数
// （queryKeyそのもの）を取り出す。識別子1つだけの場合は1段だけ変数を
// 辿る（それ以上は追わない。分割代入等で辿れない場合はnull＝fail-closed）
function resolveDirectKeyArgument(call: ts.CallExpression): ts.Node | null {
  const arg = call.arguments[0];
  if (!arg) return null;
  if (ts.isIdentifier(arg)) return findVariableInitializerInScope(call, arg.text);
  return arg;
}

// 呼び出し1件について、精密な判定にかけるべきqueryKeyノードを全て
// 集める（useQueries/useSuspenseQueriesは要素ごとに複数持つ）。
// PREFIX_MATCH_METHODSはそもそも呼ばれない（呼び出し側で分岐する）
function resolveExactKeyNodes(methodName: string, call: ts.CallExpression): ts.Node[] {
  if (QUERIES_ARRAY_SHAPE_METHODS.has(methodName)) {
    const objectLiteral = resolveOptionsObjectArgument(call);
    const queriesProp = objectLiteral?.properties.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "queries",
    );
    const queriesArray = queriesProp && ts.isArrayLiteralExpression(queriesProp.initializer) ? queriesProp.initializer : null;
    if (!queriesArray) return [];
    const nodes: ts.Node[] = [];
    for (const element of queriesArray.elements) {
      if (!ts.isObjectLiteralExpression(element)) return []; // 1件でも解決できなければ全体をfail-closedにする
      const init = queryKeyInitializer(element);
      if (!init) return [];
      nodes.push(init);
    }
    return nodes;
  }
  if (DIRECT_KEY_SHAPE_METHODS.has(methodName)) {
    const node = resolveDirectKeyArgument(call);
    return node ? [node] : [];
  }
  const objectLiteral = resolveOptionsObjectArgument(call);
  const init = objectLiteral ? queryKeyInitializer(objectLiteral) : null;
  return init ? [init] : [];
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

type CacheKeySiteStatus = "exact-ok" | "exact-ignored" | "exact-missing" | "prefix-exempt" | "bracket-notation";

interface CacheKeySite {
  file: string;
  location: string;
  methodName: string;
  status: CacheKeySiteStatus;
  // フォールトインジェクション用: 判定対象になったノードのソース範囲
  // （見つからなかった場合、または対象外の場合はnull）
  checkRange: [number, number] | null;
}

// ファイル 1 つから、キャッシュのキーを取る呼び出しを全て見つけて分類する。
// PREFIX_MATCH_METHODS は免除、EXACT_KEY_REQUIRED_METHODS は queryKey の中身を判定し、
// viewerKey が無ければ直前の ignore コメントの有無で赤/免除を分ける。ブラケット記法は
// viewerKey の有無に関わらず赤
function scanCacheKeySites(file: string, content: string, sourceFile: ts.SourceFile): CacheKeySite[] {
  const sites: CacheKeySite[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const bracketMethodName = bracketCacheKeyMethodNameOf(node);
      if (bracketMethodName) {
        sites.push({
          file,
          location: formatLocation(sourceFile, node.getStart(sourceFile)),
          methodName: bracketMethodName,
          status: "bracket-notation",
          checkRange: null,
        });
      }
      const methodName = cacheKeyMethodNameOf(node);
      if (methodName) {
        const location = formatLocation(sourceFile, node.getStart(sourceFile));
        if (PREFIX_MATCH_METHODS.has(methodName)) {
          sites.push({ file, location, methodName, status: "prefix-exempt", checkRange: null });
        } else if (CONDITIONAL_METHODS.has(methodName)) {
          // 条件（getQueriesData は戻り値を消費しない・setQueriesData は updater が関数式）を
          // 満たせば前方一致と同じ扱い。満たさなければ ignore コメントが無い限り赤。
          // 崩れているのは条件そのものなので、checkRange は呼び出し全体を指す
          const check = CONDITIONAL_METHOD_CHECKS[methodName];
          const conditionMet = check ? check(node) : false;
          if (conditionMet) {
            sites.push({ file, location, methodName, status: "prefix-exempt", checkRange: null });
          } else if (hasIgnoreComment(content, node.getStart(sourceFile))) {
            sites.push({
              file,
              location,
              methodName,
              status: "exact-ignored",
              checkRange: [node.getStart(sourceFile), node.getEnd()],
            });
          } else {
            sites.push({
              file,
              location,
              methodName,
              status: "exact-missing",
              checkRange: [node.getStart(sourceFile), node.getEnd()],
            });
          }
        } else {
          const keyNodes = resolveExactKeyNodes(methodName, node);
          const first = keyNodes[0];
          const checkRange: [number, number] | null = first ? [first.getStart(sourceFile), first.getEnd()] : null;
          if (keyNodes.length > 0 && keyNodes.every((n) => containsIdentifierNamed(n, "viewerKey"))) {
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
  // ライブラリの公開面が分類マップにちょうど一致することを固定する。ライブラリを上げて
  // 公開面が増減すると、どちらの方向でもこの 2 つが赤くなる
  it("react-queryパッケージの公開exportが、分類マップと過不足なく一致する（バージョンを上げると赤くなる）", () => {
    expect(RAW_REACT_QUERY_EXPORTS).toEqual(Object.keys(REACT_QUERY_EXPORT_CLASSIFICATION).sort());
  });

  it("QueryClientのインスタンスメソッドが、分類マップと過不足なく一致する（バージョンを上げると赤くなる）", () => {
    expect(RAW_QUERY_CLIENT_METHODS).toEqual(Object.keys(QUERY_CLIENT_METHOD_CLASSIFICATION).sort());
  });

  // 検出ロジック自体の健全性: 分類から導いた集合が空にならないことを固定する
  it("分類から導いたexact/prefixの集合が空でない（検出ロジック自体の健全性）", () => {
    expect(EXACT_KEY_REQUIRED_METHODS.size).toBeGreaterThan(0);
    expect(PREFIX_MATCH_METHODS.size).toBeGreaterThan(0);
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

  // 今日の app で使われている 9 種は、呼び出しが最低 1 件見つかることを固定する（0 件のまま
  // 「対象が無いので緑」を防ぐ）。残りの未使用の種類は後段の合成スニペットで確かめる。
  // この一覧は手書きで、セキュリティの検査ではない。リファクタで最後の cancelQueries を
  // 消せば T9 と無関係に赤くなるが、それは意図どおりで、一覧を今の使い方に合わせればよい
  it("今日のappで実際に使われている9種のAPIは、呼び出しが最低1件は見つかる（検出ロジック自体の健全性）", () => {
    const KNOWN_USED_METHODS = [
      "useQuery",
      "useInfiniteQuery",
      "setQueryData",
      "getQueryData",
      "invalidateQueries",
      "cancelQueries",
      "removeQueries",
      "setQueriesData",
      "getQueriesData",
    ];
    const sites = scanRealFiles();
    const foundMethods = new Set(sites.map((s) => s.methodName));
    for (const method of KNOWN_USED_METHODS) {
      expect(foundMethods.has(method), `${method}の呼び出しが1件も見つかりません`).toBe(true);
    }
  });

  // キャッシュのキーを取る呼び出しのうち、要求される条件（exact 系なら viewerKey、conditional
  // 系なら戻り値の消費・updater の形）を満たさず、免除もされていないものが 0 件
  it("要求される条件を満たさず、免除もされていない呼び出しは0件である", () => {
    const missing = scanRealFiles().filter((s) => s.status === "exact-missing");
    expect(
      missing,
      missing
        .map(
          (s) =>
            `${path.relative(repoRoot, s.file)}:${s.location} の ${s.methodName}(...): ${describeMissingReason(s.methodName)}`,
        )
        .join("\n"),
    ).toEqual([]);
  });

  // 免除箇所そのものを名指しで固定する（合計数だけを見ると、免除が増えても対象が同じだけ
  // 減れば埋め合わされて気づけない）。場所は行番号ではなく呼び出しのある行の中身で書く
  // （コメントの増減で行がずれても赤くしない）
  it("viewer-key-coverage-ignoreで免除されているのは想定どおり2箇所だけである", () => {
    const ignored = scanRealFiles().filter((s) => s.status === "exact-ignored");
    const lineText = (file: string, location: string) =>
      readFileSync(file, "utf8").split(/\r?\n/)[Number(location.split(":")[0]) - 1]?.trim();
    expect(
      ignored.map(
        (s) => `${path.relative(repoRoot, s.file).replace(/\\/g, "/")} (${s.methodName}): ${lineText(s.file, s.location)}`,
      ),
    ).toEqual([
      "apps/app/app/(tabs)/timeline.tsx (getQueriesData): const previousQueries = queryClient.getQueriesData<InfiniteData<PostListPage>>({",
      "apps/app/app/(tabs)/timeline.tsx (setQueryData): context?.previousQueries.forEach(([key, data]) => queryClient.setQueryData(key, data));",
    ]);
  });

  // 免除コメントに「-- 理由」が無ければ免除として扱われない
  it("「-- 理由」の無いviewer-key-coverage-ignoreは免除として扱われない", () => {
    const content =
      'import { useQuery } from "@tanstack/react-query";\n' +
      "// viewer-key-coverage-ignore\n" +
      'useQuery({ queryKey: ["x"], queryFn: async () => 1 });\n';
    const sourceFile = parseSource("no-reason.tsx", content);
    const sites = scanCacheKeySites("no-reason.tsx", content, sourceFile);
    expect(sites.some((s) => s.status === "exact-missing")).toBe(true);
  });

  // ブラケット記法は今日の app では使われていない
  it("ブラケット記法での呼び出しは今日のappに存在しない", () => {
    const bracketSites = scanRealFiles().filter((s) => s.status === "bracket-notation");
    expect(bracketSites).toEqual([]);
  });

  // ブラケット記法を実際に検出できることを合成コードで確かめる
  it("ブラケット記法（queryClient[\"setQueryData\"](...)）は検出され、viewerKeyの有無に関わらず赤になる", () => {
    const withViewerKey =
      'queryClient["setQueryData"](["couple", "get", viewerKey], data);\n';
    const withoutViewerKey = 'queryClient["setQueryData"](["couple", "get"], data);\n';
    for (const content of [withViewerKey, withoutViewerKey]) {
      const sourceFile = parseSource("bracket.tsx", content);
      const sites = scanCacheKeySites("bracket.tsx", content, sourceFile);
      expect(sites.some((s) => s.status === "bracket-notation" && s.methodName === "setQueryData")).toBe(true);
    }
  });

  // `import { useQuery as uq } from "@tanstack/react-query"` のような別名 import だと、
  // cacheKeyMethodNameOf は識別子の名前（"uq"）でしか判定できず、以降の呼び出しを一切
  // 検出できない（テスト・lint・type-check も黙って通る）。名前空間 import も同じ。
  // @tanstack/react-query からの import は別名なしの名前付き import に限り、違反を検出する
  function findReactQueryImportStatements(sourceFile: ts.SourceFile): ts.ImportDeclaration[] {
    return sourceFile.statements.filter(
      (stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) &&
        ts.isStringLiteral(stmt.moduleSpecifier) &&
        stmt.moduleSpecifier.text === "@tanstack/react-query",
    );
  }

  interface ReactQueryImportViolation {
    kind: "namespace-or-default-import" | "aliased-named-import";
    text: string;
  }

  function reactQueryImportViolations(stmt: ts.ImportDeclaration): ReactQueryImportViolation[] {
    const clause = stmt.importClause;
    if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      return [{ kind: "namespace-or-default-import", text: stmt.getText(stmt.getSourceFile()) }];
    }
    return clause.namedBindings.elements
      .filter((spec) => spec.propertyName !== undefined)
      .map((spec) => ({ kind: "aliased-named-import", text: spec.getText(spec.getSourceFile()) }));
  }

  it("@tanstack/react-queryのimportは、今日のappでは全て別名なしの名前付きimportである", () => {
    const violations: { file: string; location: string; violation: ReactQueryImportViolation }[] = [];
    for (const file of listAppSourceFiles()) {
      const sourceFile = parseSource(file);
      for (const stmt of findReactQueryImportStatements(sourceFile)) {
        for (const violation of reactQueryImportViolations(stmt)) {
          violations.push({ file, location: formatLocation(sourceFile, stmt.getStart(sourceFile)), violation });
        }
      }
    }
    expect(
      violations,
      violations
        .map((v) => `${path.relative(repoRoot, v.file)}:${v.location} の ${v.violation.text} が違反しています`)
        .join("\n"),
    ).toEqual([]);
  });

  // 別名 import・名前空間 import が違反として検知される
  it.each([
    ["別名import（import { useQuery as uq }）", 'import { useQuery as uq } from "@tanstack/react-query";\n'],
    ["名前空間import（import * as RQ）", 'import * as RQ from "@tanstack/react-query";\n'],
  ])("%s は違反として検知される", (_label, code) => {
    const sourceFile = parseSource("rq-import.tsx", code);
    const stmts = findReactQueryImportStatements(sourceFile);
    expect(stmts.length).toBeGreaterThan(0);
    const violations = stmts.flatMap((stmt) => reactQueryImportViolations(stmt));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("別名の無い名前付きimportは違反として検知されない", () => {
    const sourceFile = parseSource(
      "rq-import.tsx",
      'import { useQuery, useInfiniteQuery } from "@tanstack/react-query";\n',
    );
    const stmts = findReactQueryImportStatements(sourceFile);
    expect(stmts.length).toBeGreaterThan(0);
    const violations = stmts.flatMap((stmt) => reactQueryImportViolations(stmt));
    expect(violations).toEqual([]);
  });

  // データを返すフック・メソッド（useSuspenseQuery・useSuspenseInfiniteQuery・useQueries・
  // useSuspenseQueries・usePrefetchQuery・ensureQueryData・fetchQuery・getQueryState・
  // prefetchQuery）を 1 つずつ当てる。setQueryDefaults は既定オプションを設定するだけなので
  // 対象外（下で理由つきで確かめる）
  describe("Rが素通りさせた12通りのうち、データを返すもの（オプションオブジェクト形）", () => {
    const cases: Array<[string, string]> = [
      ["useSuspenseQuery", "useSuspenseQuery"],
      ["useSuspenseInfiniteQuery", "useSuspenseInfiniteQuery"],
      ["usePrefetchQuery", "usePrefetchQuery"],
      ["ensureQueryData（queryClient経由）", "queryClient.ensureQueryData"],
      ["fetchQuery（queryClient経由）", "queryClient.fetchQuery"],
      ["prefetchQuery（queryClient経由）", "queryClient.prefetchQuery"],
    ];

    it.each(cases)("%s は、queryKeyにviewerKeyが無ければ赤になる", (_label, callExpr) => {
      const code = `const result = ${callExpr}({ queryKey: ["couple", "get"], queryFn: async () => 1 });\n`;
      const sourceFile = parseSource("suspense.tsx", code);
      const sites = scanCacheKeySites("suspense.tsx", code, sourceFile);
      expect(sites.length).toBeGreaterThan(0);
      expect(sites.every((s) => s.status === "exact-missing")).toBe(true);
    });

    it.each(cases)("%s は、queryKeyにviewerKeyがあれば緑になる", (_label, callExpr) => {
      const code = `const result = ${callExpr}({ queryKey: ["couple", "get", viewerKey], queryFn: async () => 1 });\n`;
      const sourceFile = parseSource("suspense.tsx", code);
      const sites = scanCacheKeySites("suspense.tsx", code, sourceFile);
      expect(sites.length).toBeGreaterThan(0);
      expect(sites.every((s) => s.status === "exact-ok")).toBe(true);
    });
  });

  // getQueryState は第1引数が queryKey そのもの（setQueryData・getQueryData と同じ形）
  describe("Rが素通りさせた12通りのうち、getQueryState（直接キー形）", () => {
    it("viewerKeyの無いqueryKeyを渡すと赤になる", () => {
      const code = 'const state = queryClient.getQueryState(["couple", "get"]);\n';
      const sourceFile = parseSource("get-state.tsx", code);
      const sites = scanCacheKeySites("get-state.tsx", code, sourceFile);
      expect(sites.length).toBeGreaterThan(0);
      expect(sites.every((s) => s.status === "exact-missing")).toBe(true);
    });

    it("viewerKeyを含むqueryKeyを渡すと緑になる", () => {
      const code = 'const state = queryClient.getQueryState(["couple", "get", viewerKey]);\n';
      const sourceFile = parseSource("get-state.tsx", code);
      const sites = scanCacheKeySites("get-state.tsx", code, sourceFile);
      expect(sites.length).toBeGreaterThan(0);
      expect(sites.every((s) => s.status === "exact-ok")).toBe(true);
    });
  });

  // useQueries/useSuspenseQueriesは`{ queries: [...] }`という配列形
  describe("Rが素通りさせた12通りのうち、useQueries/useSuspenseQueries（配列形）", () => {
    it.each(["useQueries", "useSuspenseQueries"])("%sは、要素のどれか1つでもviewerKeyが無ければ赤になる", (hookName) => {
      const code =
        `const results = ${hookName}({ queries: [\n` +
        '  { queryKey: ["couple", "get", viewerKey], queryFn: async () => 1 },\n' +
        '  { queryKey: ["stats", "get"], queryFn: async () => 2 },\n' + // こちらはviewerKeyが無い
        "] });\n";
      const sourceFile = parseSource("queries.tsx", code);
      const sites = scanCacheKeySites("queries.tsx", code, sourceFile);
      expect(sites.length).toBeGreaterThan(0);
      expect(sites.every((s) => s.status === "exact-missing")).toBe(true);
    });

    it.each(["useQueries", "useSuspenseQueries"])("%sは、要素全てにviewerKeyがあれば緑になる", (hookName) => {
      const code =
        `const results = ${hookName}({ queries: [\n` +
        '  { queryKey: ["couple", "get", viewerKey], queryFn: async () => 1 },\n' +
        '  { queryKey: ["stats", "get", viewerKey], queryFn: async () => 2 },\n' +
        "] });\n";
      const sourceFile = parseSource("queries.tsx", code);
      const sites = scanCacheKeySites("queries.tsx", code, sourceFile);
      expect(sites.length).toBeGreaterThan(0);
      expect(sites.every((s) => s.status === "exact-ok")).toBe(true);
    });
  });

  // setQueryDefaults・getQueryDefaults はデータではなく既定オプションを読み書きするだけなので
  // 対象外（excluded）。分類マップに載っている（見えなくなっていない）ことを確かめる
  it("setQueryDefaults/getQueryDefaultsは、理由つきで対象外に分類されている（見えなくなってはいない）", () => {
    expect(QUERY_CLIENT_METHOD_CLASSIFICATION.setQueryDefaults?.bucket).toBe("excluded");
    expect(QUERY_CLIENT_METHOD_CLASSIFICATION.setQueryDefaults?.reason.length).toBeGreaterThan(0);
    expect(QUERY_CLIENT_METHOD_CLASSIFICATION.getQueryDefaults?.bucket).toBe("excluded");
    expect(QUERY_CLIENT_METHOD_CLASSIFICATION.getQueryDefaults?.reason.length).toBeGreaterThan(0);
    // 対象外のためALL_CACHE_KEY_METHODSには含まれない（走査自体の対象にしない）
    expect(ALL_CACHE_KEY_METHODS.has("setQueryDefaults")).toBe(false);
    expect(ALL_CACHE_KEY_METHODS.has("getQueryDefaults")).toBe(false);
  });

  // 名前空間 import・orpc 自身の別名・namespace 段の別名等を混ぜても、呼び出しの名前
  // （useQuery）を起点にしているので、options をどう組み立てたかに関係なく検出できる
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
      // 再エクスポート・`export *`・拡張子つき import。orpc の取得経路は見ないので、
      // これらでも検出できることを確かめる
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

  // 短縮記法の正当な書き方は緑になる
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

  // 短縮記法でも、viewerKey が無ければ赤になる
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

  // queryKey 変数そのものが見つからない（1 段辿っても解決できない）場合は fail-closed で赤
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

  // setQueryData・getQueryData も同じ精密さで判定される（pendingInviteQueryKey がこの形。
  // orpc を経由しない）
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

  // invalidateQueries・cancelQueries・removeQueries は viewerKey が無くても無条件に免除
  // （前方一致で複数の viewerKey 付きの枠をまとめて対象にするのが正しい）。条件つきの
  // setQueriesData・getQueriesData は下の describe で確かめる
  it("invalidateQueries/cancelQueries/removeQueriesはviewerKeyが無くても無条件に免除される", () => {
    const code =
      "queryClient.invalidateQueries({ queryKey: orpc.me.get.key() });\n" +
      "queryClient.cancelQueries({ queryKey: orpc.post.list.key() });\n" +
      "queryClient.removeQueries({ queryKey: orpc.me.get.key() });\n";
    const sourceFile = parseSource("prefix.tsx", code);
    const sites = scanCacheKeySites("prefix.tsx", code, sourceFile);
    expect(sites.length).toBe(3);
    expect(sites.every((s) => s.status === "prefix-exempt")).toBe(true);
  });

  // getQueriesData・setQueriesData は、使い方に条件がついた安全（conventions.md「条件つきの2つ」）:
  //   getQueriesData: 前方一致した全員の state.data を配列で返す。消費すれば別人のデータを読む
  //   setQueriesData: updater が関数でなければ、その値をそのまま全員の枠へ書き込む
  // 条件そのものを機械的に検査する
  describe("getQueriesData/setQueriesDataは「条件つきで安全」（038。Rが実装を読んで発見）", () => {
    it("getQueriesDataは戻り値を消費しなければ免除される（式文としてだけ呼ぶ）", () => {
      const code = 'queryClient.getQueriesData({ queryKey: orpc.post.list.key() });\n';
      const sourceFile = parseSource("conditional.tsx", code);
      const sites = scanCacheKeySites("conditional.tsx", code, sourceFile);
      expect(sites.length).toBe(1);
      expect(sites[0]?.status).toBe("prefix-exempt");
    });

    it.each([
      ["変数へ代入", 'const result = queryClient.getQueriesData({ queryKey: orpc.post.list.key() });\n'],
      ["そのまま返す（関数本体）", 'function f() { return queryClient.getQueriesData({ queryKey: orpc.post.list.key() }); }\n'],
      ["添字で読む", 'const first = queryClient.getQueriesData({ queryKey: orpc.post.list.key() })[0];\n'],
    ])("getQueriesDataの戻り値を消費する形（%s）は、免除コメントが無ければ赤になる", (_label, code) => {
      const sourceFile = parseSource("conditional.tsx", code);
      const sites = scanCacheKeySites("conditional.tsx", code, sourceFile);
      expect(sites.some((s) => s.methodName === "getQueriesData" && s.status === "exact-missing")).toBe(true);
    });

    // 「viewerKey が確認できません」だと、読んだ人が viewerKey を足してしまう（足しても
    // 直らない）。壊れている条件そのものを言う文言になっていることを確かめる
    it("getQueriesDataが赤いときのメッセージは、viewerKeyを足せと誘導せず、戻り値を消費していることを言う", () => {
      const message = describeMissingReason("getQueriesData");
      expect(message).not.toBe(describeMissingReason("useQuery")); // 汎用文言のままではない
      expect(message).toMatch(/戻り値/);
      expect(message).not.toMatch(/viewerKeyを(足|追加|含め)/); // 「足せば直る」という誘導をしない
    });

    it("getQueriesDataの戻り値を消費していても、ignoreコメントがあれば免除される", () => {
      const code =
        "// viewer-key-coverage-ignore -- 戻り値はcontext経由でonErrorのsetQueryDataへ同じキーで書き戻すためだけに使う\n" +
        "const result = queryClient.getQueriesData({ queryKey: orpc.post.list.key() });\n";
      const sourceFile = parseSource("conditional.tsx", code);
      const sites = scanCacheKeySites("conditional.tsx", code, sourceFile);
      expect(sites.some((s) => s.methodName === "getQueriesData" && s.status === "exact-ignored")).toBe(true);
    });

    it("setQueriesDataはupdaterが関数式であれば免除される", () => {
      const code = 'queryClient.setQueriesData({ queryKey: orpc.post.list.key() }, (old) => old);\n';
      const sourceFile = parseSource("conditional.tsx", code);
      const sites = scanCacheKeySites("conditional.tsx", code, sourceFile);
      expect(sites.length).toBe(1);
      expect(sites[0]?.status).toBe("prefix-exempt");
    });

    it.each([
      ["値をそのまま渡す", 'queryClient.setQueriesData({ queryKey: orpc.post.list.key() }, someData);\n'],
      ["オブジェクトリテラルを渡す", 'queryClient.setQueriesData({ queryKey: orpc.post.list.key() }, { items: [] });\n'],
    ])("setQueriesDataのupdaterが関数式でない形（%s）は、免除コメントが無ければ赤になる", (_label, code) => {
      const sourceFile = parseSource("conditional.tsx", code);
      const sites = scanCacheKeySites("conditional.tsx", code, sourceFile);
      expect(sites.some((s) => s.methodName === "setQueriesData" && s.status === "exact-missing")).toBe(true);
    });

    it("setQueriesDataが赤いときのメッセージは、viewerKeyではなくupdaterが関数式でないことを言う", () => {
      expect(describeMissingReason("setQueriesData")).not.toMatch(/viewerKey/);
      expect(describeMissingReason("setQueriesData")).toMatch(/updater/);
    });
  });

  // 判定が効いていることを、実際に viewerKey を 1 つ外して確かめる。実ファイルで exact-ok の
  // 全ての checkRange について、そこだけ "viewerKey" を書き換え、(1) その箇所が exact-ok の
  // まま緑を保たないこと (2) 同じファイルの他の呼び出しが巻き添えで壊れないことを見る
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

// 除外は apps/app 直下の 1 パスだけ。実際に apps/app/app/test/ へファイルを置いて確かめる
// （作業後は必ず削除する）
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

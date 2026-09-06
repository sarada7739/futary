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

// 【038: Aの判断「閉じた集合を、手で写さない。出どころから引く」】
// 037で「TanStack Queryのキャッシュのキーを取るAPI」という閉じた集合へ
// 留め金を移したこと自体は正しかった（Rの判定）。だが実際には手で9件を
// 書き写しただけで、ライブラリの実物とは突き合わせていなかった。Rが
// `@tanstack/react-query@5.102.3`の公開面を読んだところ、13通り当てて
// 12通りが素通りした（useSuspenseQuery・useQueries・ensureQueryData・
// fetchQuery・getQueryState等）。「閉じた集合であることと、その集合を
// 正しく持っていることは別だった」（Aの言葉）。
//
// テスト実行時に実際のモジュールを読み、そこから列挙する
// （`ts.createProgram`は使わない。読むのはモジュールの値そのもの）
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
  // "conditional": 「前方一致だから安全」ではなく「使い方に条件がついた
  //   安全」（038。Rが実装を読んで発見）。条件が崩れたらexactと同じ
  //   扱いにする。CONDITIONAL_METHOD_CHECKSに対応する条件関数を持つ
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
  // 【Rレビュー指摘・訂正】以前は「前方一致だから安全」（prefix）と
  // 書いていたが、実装（下記コメント参照）を読んだRの指摘により誤りと
  // 判明した。「前方一致だから安全」ではなく「使い方に条件がついた
  // 安全」であり、条件が崩れると別人の枠を覗く・別人の枠へ書く事故に
  // なりうる（T9）。条件はCONDITIONAL_METHOD_CHECKSで機械的に検査する
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

// 【038: Rレビュー指摘】getQueriesData/setQueriesDataは「前方一致だから
// 安全」ではなく「使い方に条件がついた安全」だった。条件が崩れたら、
// queryKeyにviewerKeyがあるかとは別の理由で別人のデータを覗く・
// 別人のデータへ書く事故になりうる（T9）。条件を機械的に検査する
// （conventions.md「条件は検査する。書くだけにしない」）

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

// 【Rレビュー指摘・訂正】conditionalな2つが条件を満たさず赤くなった
// とき、他の呼び出しと同じ「viewerKeyが確認できません」という文言を
// 出していた。だがこの2つが崩れているのはviewerKeyの有無ではなく
// 条件そのもの（戻り値を消費していない／updaterが関数式である）で
// あり、この文言を読んだ人がviewerKeyを足しても直らない
// （短縮記法のときと同じ「一番悪い壊れ方」。メッセージが嘘をつく）。
// 対象のAPIごとに、何が壊れているかを言う文言に分ける
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

// 【038: Rの指摘】ブラケット記法（`queryClient["setQueryData"](...)`）は
// 上のcacheKeyMethodNameOfに一致しない（PropertyAccessExpressionではなく
// ElementAccessExpressionのため）。ドット記法に限る、という入口の形を
// 決めた結果、これは「使い方が違反している」呼び出しとして別途検知する
// （lib/orpcを名前付きimportに限ったのと同じ考え方）
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

// ファイル1つから、キャッシュのキーを取る呼び出しを全て見つけ、それぞれを
// 分類する。PREFIX_MATCH_METHODSは構造的に免除（viewerKey不要）、
// EXACT_KEY_REQUIRED_METHODSはqueryKeyの中身を精密に判定し、
// viewerKeyが無ければ直前のignoreコメントの有無で赤/免除を分ける。
// ブラケット記法（`queryClient["setQueryData"](...)`）はドット記法に
// 限るという入口の形に反するため、viewerKeyの有無に関わらず赤にする
// （038: Aの判断「入口の形を1つに決める」）
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
          // 【038: Rレビュー指摘】条件（getQueriesDataなら戻り値を消費
          // しないこと、setQueriesDataならupdaterが関数式であること）を
          // 満たしていれば前方一致と同じ扱い（安全）。満たしていなければ、
          // ignoreコメントが無い限り赤にする（queryKeyのviewerKeyの
          // 有無ではなく、条件そのものが崩れていることが問題のため、
          // checkRangeは呼び出し全体を指す）
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
  // 【038: 受け入れの形「ライブラリから引いた一覧がtoEqualで固定されている」】
  // ライブラリの公開面（RAW_REACT_QUERY_EXPORTS・RAW_QUERY_CLIENT_METHODS）
  // が、分類マップ（REACT_QUERY_EXPORT_CLASSIFICATION・
  // QUERY_CLIENT_METHOD_CLASSIFICATION）にちょうど一致することを固定する。
  // ライブラリを上げて公開面が増減すると、この2つが必ず赤くなる
  // （増えたものは分類マップに無いので欠け、減ったものは分類マップに
  // 余分に残るため、どちらの方向でも診断で気づける）
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

  // 検出ロジック自体の健全性: 実際に今日のapp内で使われている9種については
  // 呼び出しが最低1件は見つかることを固定する。0件のまま「対象が無いので
  // 緑」というテストの見せかけの安全を防ぐ（#245「逃げ道の側を数える」と
  // 同じ考え方）。残り17種（useSuspenseQuery・ensureQueryData等。038で
  // ライブラリから新たに引いたもの）は今日のappでは未使用のため、ここでは
  // 求めない。それらの判定ロジックが機能することは後段の合成スニペットの
  // テスト（Rが挙げた12通り等）で別途確認する。
  // 【Rの注文】この一覧は手書きであり、セキュリティの検査ではなく
  // 「今日実際に使われているものが消えていないか」の確認である。
  // 例えばリファクタで`cancelQueries`の呼び出しを1件削除すると、
  // T9とは無関係にこのテストが赤くなる——それは意図どおりであり、
  // 一覧をその時点の実際の使用状況に合わせて更新すればよい
  // （「なぜ赤いのか」を探させないためにここに書く）
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

  // 【受け入れの形】キャッシュのキーを取る呼び出しのうち、精密な判定の
  // 対象になっていないもの（要求される条件——exact系ならviewerKey、
  // conditional系なら戻り値の消費/updaterの形——を満たさず、免除も
  // されていない）が0件であることを固定する。
  // 【Rの注文・採用】以前の題名「viewerKeyが無く...」は、失敗時に
  // まず目に入る見出し自体がviewerKeyの話をしていた。conditionalな
  // 2つのメッセージ本文を条件の話に直したのに、見出しが揃っていな
  // かった（実害は小さいが、中身と見出しは揃える）
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

  // 【受け入れの形】免除は理由つきで一覧に載り、載っていない免除は赤。
  // 免除箇所そのものを名指しで固定する（合計数だけを見ると、免除が
  // 増えても対象が同じだけ減れば埋め合わされて気づけないため）
  it("viewer-key-coverage-ignoreで免除されているのは想定どおり2箇所だけである", () => {
    const ignored = scanRealFiles().filter((s) => s.status === "exact-ignored");
    expect(
      ignored.map((s) => `${path.relative(repoRoot, s.file).replace(/\\/g, "/")}:${s.location} (${s.methodName})`),
    ).toEqual([
      "apps/app/app/(tabs)/timeline.tsx:54:33 (getQueriesData)",
      "apps/app/app/(tabs)/timeline.tsx:75:59 (setQueryData)",
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

  // 【受け入れの形「別名import・ブラケット記法が赤」】ブラケット記法は
  // 今日のappでは使われていないことを固定する
  it("ブラケット記法での呼び出しは今日のappに存在しない", () => {
    const bracketSites = scanRealFiles().filter((s) => s.status === "bracket-notation");
    expect(bracketSites).toEqual([]);
  });

  // 対になる確認: ブラケット記法を実際に検出できることを合成コード
  // （Rの逃げ道例）で確かめる
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

  // 【038: Aの判断「入口の形を1つに決める」。037でlib/orpcに対して
  // やったのと同じ形をreact-query自体のimportにも適用する】
  // `import { useQuery as uq } from "@tanstack/react-query"`のように
  // 別名でimportされると、cacheKeyMethodNameOfは識別子の名前（"uq"）
  // でしか判定できないため、以降の呼び出しが一切検出できなくなる
  // （Rが実測: profile.tsxで穴を開けた状態で、テスト・app・lint・
  // type-checkの4つとも黙って通った）。名前空間importも同様に、
  // メンバー名が識別子として現れないため検出できない。
  // 「@tanstack/react-queryからのimportは、別名なしの名前付きimportに
  // 限る」という入口の形を決め、違反そのものを検出する
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

  // 【Rの受け入れ条件】別名import・名前空間importが違反として検知される
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

  // 【038: 受け入れの形「Rが素通りさせた12通りが全部赤」】
  // Rが`@tanstack/react-query@5.102.3`の公開面を読んで実測した12通り
  // （useSuspenseQuery・useSuspenseInfiniteQuery・useQueries・
  // useSuspenseQueries・usePrefetchQuery・ensureQueryData・fetchQuery・
  // getQueryState・prefetchQuery・setQueryDefaults・ブラケット記法・
  // 別名import）を1つずつ当てる。ブラケット記法・別名importは既に
  // 上のテストで確認済みのため、ここでは残り10通り（データを返す
  // フック・メソッド）を確かめる。038のtoEqual完全性テストにより、
  // これらは全て分類マップに載っている（見えなくなることはない）。
  // うちsetQueryDefaultsは「データではなく既定オプションを設定する
  // だけ」という理由で対象外に分類しており、赤にはならない——それも
  // 含めて、全て理由つきで説明できることを示す
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

  // getQueryStateは第1引数がqueryKeyそのもの（setQueryData/getQueryDataと
  // 同じ直接キー形）
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

  // setQueryDefaults/getQueryDefaultsは「データではなく既定オプションを
  // 読み書きするだけ」という理由で対象外（excluded）に分類した。
  // 分類マップに載っている（見えなくなっていない）ことと、その理由を
  // 明示的に確認する
  it("setQueryDefaults/getQueryDefaultsは、理由つきで対象外に分類されている（見えなくなってはいない）", () => {
    expect(QUERY_CLIENT_METHOD_CLASSIFICATION.setQueryDefaults?.bucket).toBe("excluded");
    expect(QUERY_CLIENT_METHOD_CLASSIFICATION.setQueryDefaults?.reason.length).toBeGreaterThan(0);
    expect(QUERY_CLIENT_METHOD_CLASSIFICATION.getQueryDefaults?.bucket).toBe("excluded");
    expect(QUERY_CLIENT_METHOD_CLASSIFICATION.getQueryDefaults?.reason.length).toBeGreaterThan(0);
    // 対象外のためALL_CACHE_KEY_METHODSには含まれない（走査自体の対象にしない）
    expect(ALL_CACHE_KEY_METHODS.has("setQueryDefaults")).toBe(false);
    expect(ALL_CACHE_KEY_METHODS.has("getQueryDefaults")).toBe(false);
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

  // invalidateQueries/cancelQueries/removeQueriesは、viewerKeyが無くても
  // 無条件に免除される（前方一致で複数のviewerKey付き枠をまとめて
  // 対象にすることが設計上正しいため）ことを確かめる。setQueriesData/
  // getQueriesDataは条件つきのため、このテストからは外し、下の専用の
  // describeで確かめる
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

  // 【038: Rレビュー指摘・訂正】getQueriesData/setQueriesDataは「前方一致
  // だから安全」ではなく「使い方に条件がついた安全」だった
  // （conventions.md「条件つきの2つ」）。以前は無条件でprefix-exempt
  // としていたが、実装を読んだRの指摘で誤りと判明した:
  //   getQueriesData: 前方一致に一致した全員のstate.dataをそのまま
  //     配列に入れて返す。呼び出し側が消費すれば別人のデータを読む
  //   setQueriesData: updaterが関数でなければ、その値をそのまま全員の
  //     枠へ書き込む（functionalUpdateの実装）
  // 「理由が違うと、次にgetQueriesData(...)[0][1]を読んで画面に出す人が
  // 止まらない」（Rの指摘）。条件そのものを機械的に検査する
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

    // 【Rレビュー指摘・訂正】メッセージが「viewerKeyが確認できません」だと
    // 読んだ人がviewerKeyを足してしまう（条件が崩れているだけなので、
    // 足しても直らない。「一番悪い壊れ方」）。壊れている条件そのものを
    // 言う文言になっていることを確かめる
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

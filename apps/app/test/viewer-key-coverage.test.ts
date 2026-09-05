import { readdirSync, readFileSync } from "node:fs";
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
// 手で一覧を並べて維持すると、新しい画面や新しい手続きを足したときに
// 対策を入れ忘れる（Rレビュー・A決定: 「手で並べず、定義を走査する形が
// 望ましい」。root-route.test.tsを32通りの総当たりにしたのと同じ考え方）。
// このテストはapps/api側の実際の定義（どの手続きがreadProcedureを使うか）
// を読み取ってから、apps/app側の呼び出し箇所を機械的に確認する。
//
// 【Rレビュー指摘で追加】走査ロジックはreadProcedureの使用箇所しか見ない
// ため、readProcedureを使わない`me.get`が構造的に映らず、対策漏れに
// 気づけなかった（実際に発生。名前・メールアドレス・アイコン画像という
// 利用者ごとのデータを返すにもかかわらず）。`me.get`は`health.get`と並んで
// 認可基底を経由しない唯一の許可リスト（apps/api/test/authorization.test.tsの
// `ALLOWED_WITHOUT_BASE`）に入っている。このうち`health.get`は利用者データを
// 返さないため対象外、`me.get`は対象——という判断はreadProcedureの走査だけ
// からは導けないため、ここでは明示的に一覧へ追加する（走査で拾えない例外は
// 「無い」とみなさず、「ある」と明示することでしか塞げない）
const MANUALLY_INCLUDED_PROCEDURES = [
  // health.get/me.getのうちme.getだけが対象。理由は上のコメント参照
  "me.get",
];

// 【A決定・PR #178】T9の対象は「手続きの戻り値」に限らない。当初この節を
// 「問い合わせ」で書いたのが狭かった（Rが発見）。
// `apps/app/app/(onboarding)/invite.tsx`の`pendingInviteQueryKey`は
// サーバの手続きではなくTanStack Queryをただの置き場として使っており
// （中身は招待コード。ペアに入るための鍵でT2より直接的な開示になる）、
// `orpc.<namespace>.<method>.(queryOptions|infiniteOptions)`という
// 呼び出し形を前提にするfindReadScopedProceduresの走査には元から
// 掛からない。手続きの走査だけに頼る構造そのものが穴であるため
// （me.getが抜けたのと同じ形が2回目に出た）、「手続き名+自動導出した
// 呼び出しパターン」ではなく「ラベル+呼び出しパターンそのもの」を
// 明示的に登録できる形に一般化した
// 【Rレビュー指摘R-2・作りを変えた】検証の粒度は当初「呼び出し箇所の前後
// N文字にviewerKeyという文字列があるか」（テキストの近傍）だったが、
// 隣接する別の呼び出し（例: ai-summary.tsxのmeQuery宣言がsummaryQueryの
// 直前2行にある）の宣言をviewerKeyの根拠として誤って拾ってしまい、
// summaryQueryのqueryKeyから実際にviewerKeyを外しても15件全部緑のまま、
// という検知漏れをRが実測した（300→100文字への訂正を含め、これで3回目の
// 破れ）。「窓を狭めない。作りを変える」というAの指示どおり、TypeScript
// コンパイラのAST解析に置き換えた。呼び出し1つ1つについて、それが実際に
// どのuseQuery/useInfiniteQuery呼び出しのqueryKeyに使われているかを
// 構文木で辿って特定し、そのqueryKey配列（の初期化式）自体の中に
// viewerKeyという識別子があるかだけを見る。これなら「別の呼び出しの宣言が
// たまたま近くにある」ことでは緑にならない（構造的に別の式のため）
interface ViewerKeyTarget {
  label: string;
}

interface OrpcQueryTarget extends ViewerKeyTarget {
  kind: "orpc";
  namespace: string;
  method: string;
}

interface ManualCacheKeyTarget extends ViewerKeyTarget {
  kind: "manual";
  // viewerKeyを直接引数に取る関数呼び出しの識別子名
  calleeName: string;
}

type Target = OrpcQueryTarget | ManualCacheKeyTarget;

const MANUALLY_PLACED_CACHE_KEYS: ManualCacheKeyTarget[] = [
  {
    kind: "manual",
    label: "onboarding.pendingInvite",
    calleeName: "pendingInviteQueryKey",
  },
];

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(testDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const proceduresDir = path.join(repoRoot, "apps", "api", "src", "procedures");

function listFilesRecursive(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
}

// apps/api/src/procedures/*.ts から「implementer.<namespace>.<method>.use(readProcedure)」
// の形を拾い、"couple.get"のような手続き名を集める
function findReadScopedProcedures(): string[] {
  const files = listFilesRecursive(proceduresDir).filter((f) => f.endsWith(".ts"));
  const pattern = /implementer\.([a-zA-Z]+\.[a-zA-Z]+)\.use\(readProcedure\)/g;
  const found: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(pattern)) {
      const captured = match[1];
      if (captured) found.push(captured);
    }
  }
  return found;
}

function listAppSourceFiles(): string[] {
  const targets = [path.join(appDir, "app"), path.join(appDir, "components")];
  return targets
    .flatMap((dir) => listFilesRecursive(dir))
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
}

// 手続き名（"couple.get"のような形）から、oRPCの呼び出し対象を導出する
function orpcCallTarget(procedure: string): OrpcQueryTarget {
  const parts = procedure.split(".");
  if (parts.length !== 2) throw new Error(`想定外の手続き名の形式です: ${procedure}`);
  const [namespace, method] = parts;
  if (!namespace || !method) throw new Error(`想定外の手続き名の形式です: ${procedure}`);
  return { kind: "orpc", label: procedure, namespace, method };
}

function parseSource(file: string): ts.SourceFile {
  const content = readFileSync(file, "utf8");
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

function isOrpcQueryCall(node: ts.Node, namespace: string, method: string): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const memberAccess = node.expression;
  if (!ts.isPropertyAccessExpression(memberAccess)) return false;
  if (memberAccess.name.text !== "queryOptions" && memberAccess.name.text !== "infiniteOptions") return false;
  const methodAccess = memberAccess.expression;
  if (!ts.isPropertyAccessExpression(methodAccess) || methodAccess.name.text !== method) return false;
  const namespaceAccess = methodAccess.expression;
  if (!ts.isPropertyAccessExpression(namespaceAccess) || namespaceAccess.name.text !== namespace) return false;
  return ts.isIdentifier(namespaceAccess.expression) && namespaceAccess.expression.text === "orpc";
}

function isUseQueryCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === "useQuery" || node.expression.text === "useInfiniteQuery")
  );
}

function queryKeyInitializer(objectLiteral: ts.ObjectLiteralExpression): ts.Node | null {
  const prop = objectLiteral.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "queryKey",
  );
  return prop ? prop.initializer : null;
}

// 【Rレビュー指摘R-2・作りを変えた】orpc.<ns>.<method>.queryOptions(...)の
// 呼び出し1件について、それが実際にどのuseQuery/useInfiniteQueryの
// queryKeyへ渡っているかをAST上で辿り、そのqueryKey配列（の初期化式）
// そのものを返す。近傍の文字列ではなく、構文的に同じ式に属するノードだけを
// 見るため、隣接する別の宣言・別の呼び出しを誤って拾うことがない。
// 実際のコードにある3つの書き方に対応する:
//   (a) useQuery({ ...orpc.x.method.queryOptions(), queryKey: [...] })
//       （options.queryKeyへのspreadに直接使う形。1つのuseQuery呼び出しの
//       中にこの関数と同じ呼び出しがもう1回、(b)として現れる）
//   (b) [...orpc.x.method.queryOptions().queryKey, viewerKey]
//       （queryKeyだけを取り出してspreadする形。(a)と同じuseQuery呼び出し
//       の中にある2つ目の出現）
//   (c) const xOptions = orpc.x.method.queryOptions(...); のように変数に
//       受けてから、離れた場所のuseQuery({ ...xOptions, queryKey: [...] })
//       で使う形（ai-summary.tsx等）
// どの形にも当てはまらなければnull（＝viewerKeyの利用が確認できない）を返す
function resolveOrpcCallCheckNode(call: ts.CallExpression): ts.Node | null {
  const parent = call.parent;

  // (b) call.queryKey が配列へspreadされている
  if (ts.isPropertyAccessExpression(parent) && parent.name.text === "queryKey") {
    const spread = parent.parent;
    if (ts.isSpreadElement(spread) && ts.isArrayLiteralExpression(spread.parent)) {
      return spread.parent;
    }
    return null;
  }

  // (a) useQuery/useInfiniteQueryの引数オブジェクトへ直接spreadしている
  if (ts.isSpreadAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) {
    const objectLiteral = parent.parent;
    if (isUseQueryCall(objectLiteral.parent)) {
      return queryKeyInitializer(objectLiteral);
    }
    return null;
  }

  // (c) 一度変数に受けてから、同じファイル内のuseQuery/useInfiniteQueryへ
  // spreadしている（呼び出しそのものは1回しか現れないため、変数名を
  // 手がかりに、それをspreadしているuseQuery呼び出しを別途探す）
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    const varName = parent.name.text;
    const sourceFile = call.getSourceFile();
    let found: ts.Node | null = null;
    function visit(n: ts.Node): void {
      if (found) return;
      const firstArg = isUseQueryCall(n) && n.arguments.length === 1 ? n.arguments[0] : undefined;
      if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
        const objectLiteral = firstArg;
        const spreadsVar = objectLiteral.properties.some(
          (p) => ts.isSpreadAssignment(p) && ts.isIdentifier(p.expression) && p.expression.text === varName,
        );
        if (spreadsVar) {
          found = queryKeyInitializer(objectLiteral);
          return;
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(sourceFile);
    return found;
  }

  return null;
}

interface CallSiteResult {
  file: string;
  position: number;
  hasViewerKey: boolean;
  // このcheckNode自体のソース上の範囲（フォールトインジェクション用。
  // 「viewerKeyという文字列をここだけ書き換えたら赤くなるか」を確かめる
  // ために使う。見つからなかった場合はnull）
  checkRange: [number, number] | null;
}

// filesOverride: {ファイルパス: 差し替えたソース文字列}。フォールト
// インジェクションのテストで、実ファイルを書き換えずに「ある1箇所だけ
// viewerKeyを外した状態」を再現するために使う
function checkTarget(target: Target, files: string[], filesOverride: Record<string, string> = {}): CallSiteResult[] {
  const results: CallSiteResult[] = [];
  for (const file of files) {
    const sourceFile = Object.hasOwn(filesOverride, file)
      ? ts.createSourceFile(
          file,
          filesOverride[file] as string,
          ts.ScriptTarget.Latest,
          true,
          file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        )
      : parseSource(file);
    function visit(node: ts.Node): void {
      if (target.kind === "orpc" && isOrpcQueryCall(node, target.namespace, target.method)) {
        const checkNode = resolveOrpcCallCheckNode(node);
        results.push({
          file,
          position: node.getStart(sourceFile),
          hasViewerKey: checkNode !== null && containsIdentifierNamed(checkNode, "viewerKey"),
          checkRange: checkNode ? [checkNode.getStart(sourceFile), checkNode.getEnd()] : null,
        });
      } else if (
        target.kind === "manual" &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === target.calleeName
      ) {
        // 手書きの固定キー関数は、viewerKeyがその呼び出し自身の引数として
        // 直接渡されているかだけを見ればよい（useQueryのqueryKeyのような
        // 別の式を辿る必要が無い）
        results.push({
          file,
          position: node.getStart(sourceFile),
          hasViewerKey: containsIdentifierNamed(node, "viewerKey"),
          checkRange: [node.getStart(sourceFile), node.getEnd()],
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return results;
}

describe("ペアのデータ・利用者ごとのデータを読む問い合わせは、queryKeyにviewerKeyを含める（T9）", () => {
  const targetProcedures = [...findReadScopedProcedures(), ...MANUALLY_INCLUDED_PROCEDURES];
  // 「手続きの戻り値」（oRPC経由）と「利用者ごとに違う値を持つ、こちらが
  // 置いたキャッシュ」（MANUALLY_PLACED_CACHE_KEYS）の両方を、同じ形
  // （Target）に揃えてから一括で検査する（A決定・PR #178）
  const targets: Target[] = [...targetProcedures.map(orpcCallTarget), ...MANUALLY_PLACED_CACHE_KEYS];

  // 検出ロジック自体が壊れて0件になった場合、以降のitが1件も生成されず
  // 静かにテストが「何も確認していない」状態になる。それを防ぐ
  it("対象の手続きを検出できている（検出ロジック自体の健全性）", () => {
    expect(targetProcedures.length).toBeGreaterThanOrEqual(6);
    expect(targetProcedures).toEqual(
      expect.arrayContaining(["couple.get", "stats.get", "memory.get", "post.list", "event.list", "me.get"]),
    );
  });

  // 【Rレビュー指摘】上の番人は`targetProcedures`（手続き側）しか見ておらず、
  // `MANUALLY_PLACED_CACHE_KEYS`（こちらが置いた値）が空になっても
  // 検知できない。手で維持する一覧である以上、消えたときに気づける
  // 仕組みは手続き側と同じだけ要る。
  //
  // 【Rレビュー指摘・訂正】当初`targets.length`（合計）で見ていたが、
  // これは`targetProcedures`が7本に増えた瞬間、`MANUALLY_PLACED_CACHE_KEYS`が
  // 0件に減っても合計7のまま緑になり、静かに効かなくなる（埋め合わせが
  // 効いてしまう）。上の番人が数だけでなく名前も固定しているのと同じ形に、
  // こちらもラベルそのものを固定する
  it("こちらが置いた値の対象も検出できている（検出ロジック自体の健全性）", () => {
    expect(targets.map((t) => t.label)).toEqual(expect.arrayContaining(["onboarding.pendingInvite"]));
  });

  for (const target of targets) {
    it(`${target.label} を呼ぶ箇所は、それぞれ自分自身のqueryKeyでviewerKeyを参照している`, () => {
      const files = listAppSourceFiles();
      const results = checkTarget(target, files);

      // 【Rレビュー指摘R-2】呼び出し方が変わる・ラッパを噛ませる等でASTの
      // 判定パターンが一致しなくなると、resultsが0件のままループが1度も
      // 回らず、テストが「確認していないのに緑」になる。呼び出し箇所が
      // 実在することを要求することでそれを防ぐ
      expect(
        results.length,
        `${target.label} の呼び出し箇所が見つかりません（判定パターンが実際の書き方と一致していない可能性）`,
      ).toBeGreaterThan(0);

      for (const r of results) {
        expect(
          r.hasViewerKey,
          `${path.relative(repoRoot, r.file)} の ${target.label} 呼び出し（位置 ${r.position}）の` +
            `queryKeyでviewerKeyが確認できません`,
        ).toBe(true);
      }
    });
  }

  // 【Rレビュー指摘R-2の実証】判定ロジック自体が「効いていること」を、
  // 実際にviewerKeyを1つ外した状態を作って確かめる。「対象に列挙されている」
  // は「効いている」ではない、というRの指摘（summaryQueryのqueryKeyから
  // viewerKeyを実際に外しても15件全部緑のままだった）に対するAの受け入れ
  // 条件：「走査の対象すべてについて、viewerKeyを1つ外したら赤くなること
  // を確かめる。対象が8つあるなら、8通り試す」（#246「測定を足したら、
  // 両側から当てる」）。手で書き並べる代わりに、対象一覧（targets）自体を
  // 総当たりし、各呼び出し箇所ごとにフォールトインジェクションを行う
  // （走査自体に組み込む形。Aに作り方は一任されている）。
  //
  // ある1箇所のcheckRange（そのuseQueryのqueryKey配列、または手書きの
  // 呼び出しそのもの）だけを狙って"viewerKey"という文字列を無関係な
  // 識別子名に書き換えた一時ソースを作り、(1)その箇所自身が赤くなること
  // (2)同じファイル内の他の対象（隣の宣言等）が巻き添えで赤くならないこと
  // の両方を確かめる。実ファイルは一切書き換えない（filesOverrideで
  // メモリ上のソース文字列だけを差し替える）
  it("対象ごとに、その呼び出し1箇所からviewerKeyを外すとそこだけが赤くなり、他は巻き添えにならない", () => {
    const files = listAppSourceFiles();
    let injectionCount = 0;

    for (const target of targets) {
      const baseline = checkTarget(target, files);
      expect(baseline.length, `${target.label}: 呼び出し箇所が見つかりません`).toBeGreaterThan(0);

      for (const site of baseline) {
        expect(site.hasViewerKey, `${target.label} (${site.file}:${site.position}) が変更前から赤い`).toBe(true);
        if (!site.checkRange) {
          throw new Error(`${target.label} (${site.file}:${site.position}): checkRangeが取得できていない`);
        }
        const [start, end] = site.checkRange;
        const originalContent = readFileSync(site.file, "utf8");
        const mutated =
          originalContent.slice(0, start) +
          originalContent.slice(start, end).replaceAll("viewerKey", "viewerKeyRemovedForFaultInjection") +
          originalContent.slice(end);
        expect(mutated, `${target.label} (${site.file}:${site.position}): 置換が実際に効いていない`).not.toBe(
          originalContent,
        );

        const filesOverride = { [site.file]: mutated };

        // (1) この箇所自身が赤くなる
        const afterForThisTarget = checkTarget(target, [site.file], filesOverride);
        expect(
          afterForThisTarget.some((r) => !r.hasViewerKey),
          `${target.label} (${site.file}:${site.position}): viewerKeyを外しても赤くならない`,
        ).toBe(true);

        // (2) 同じファイル内の他の対象は巻き添えで赤くならない
        // （近傍の文字列ではなく構文的に別の式を見ているはず、という
        // R-2の作り直し自体の検証）
        for (const otherTarget of targets) {
          if (otherTarget === target) continue;
          const otherResults = checkTarget(otherTarget, [site.file], filesOverride);
          for (const otherSite of otherResults) {
            expect(
              otherSite.hasViewerKey,
              `${target.label} (${site.file}:${site.position}) からviewerKeyを外したら、` +
                `無関係な ${otherTarget.label} まで巻き添えで赤くなった`,
            ).toBe(true);
          }
        }

        injectionCount += 1;
      }
    }

    // 対象すべてについて、少なくとも1呼び出し箇所でフォールトインジェクション
    // を実施したこと（0件のまま緑になっていないか）
    expect(injectionCount).toBeGreaterThanOrEqual(targets.length);
  });
});

// queryClient.setQueryData/getQueryDataを直接呼んでいる箇所も、リテラルの
// 固定キー（viewerKeyを含まないキー）を書き込む/読み取ると、
// `[...queryKey, viewerKey]`という実際のキャッシュ枠とは別の場所に触れる
// ことになり、書き込みが黙って効かない（join.tsxの不具合。PR #199。
// 人間の本番の実機報告で発覚するまでCIで検知できなかった）。
//
// `orpc.*.queryKey()`を直接渡す形はeslint.config.jsのno-restricted-syntax
// で構文的に禁止した（Rレビュー指摘: ASTなら第1引数がorpcのメンバ呼び出しか
// 識別子かを確実に区別できる）。ここではlintのセレクタに一致しない残り
// （orpcを経由しない手書きのキー、例: pendingInviteQueryKey(viewerKey)）を
// 走査する。
//
// 【Rレビュー指摘・訂正】当初は「引数が単純な識別子1つだけの呼び出しは
// 動的な実キーとみなして対象外にする」という判定基準にしていたが、これは
// 「長い式を変数に出す」というごく普通のリファクタ1回で、lint・走査の
// 両方をすり抜けてしまう（`const key = orpc.couple.get.queryKey();
// queryClient.setQueryData(key, couple);`と書けば#199のバグそのものが
// 静かに素通りする）。識別子引数も含めて全ての呼び出しを対象にし、
// 動的な実キーを渡す正当な理由がある箇所（timeline.tsxの楽観的更新
// ロールバック。getQueriesDataで取得した実キーをそのまま書き戻すだけ）
// だけを、直前行の`viewer-key-coverage-ignore`コメントで明示的に除外する。
// 目印は要るが、ESLintのdisableコメントと同じ「慣用・grep可能・diffに
// 出る」形にする（独自の目印コメントを退けたのは「静かに検査を黙らせる
// 安い手段になるから」であって、慣用の印そのものを禁じたわけではない）
describe("queryClient.setQueryData/getQueryDataを直接呼ぶ箇所は、固定キーならviewerKeyを含む（T9）", () => {
  // 【Rレビュー指摘R-1】メソッド名と`(`の間にジェネリクス（TypeScriptで
  // 普通の書き方。例: getQueryData<IssuedInvite>(...)）が挟まると
  // 素通りしていた。実測するとinvite.tsx:31（getQueryData<IssuedInvite>）が
  // 検出対象から漏れていた
  const DIRECT_CACHE_CALL_PATTERN = /queryClient\.(?:setQueryData|getQueryData)\s*(?:<[^>]*>)?\s*\(/g;
  // 「-- 理由」まで要求する（規約として書くなら、規約が守られていることも
  // 検査する。Rレビュー指摘・任意対応）
  const IGNORE_COMMENT_PATTERN = /viewer-key-coverage-ignore\s+--\s+\S/;
  const DIRECT_CACHE_CONTEXT_WINDOW = 100;

  // 呼び出し行の直前に連続する`//`コメント行をさかのぼって全て結合する
  // （複数行のコメントで理由を書いても検出できるように。1行しか見ないと、
  // コメントを2行以上に書いた瞬間に免除が効かなくなる）
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

  // 【Rレビュー指摘R-2】マッチした行自体が`//`コメント行だと、コード例を
  // 説明したコメント（join.tsxの不具合修正コメント等）を実際の呼び出しと
  // 誤って数えてしまう。偽陽性（コメントにviewerKeyが無いと存在しない
  // 呼び出しで落ちる）と番人の水増し（コメント1件が実コード減少の
  // 埋め合わせになる）の両方を引き起こすため、行自体がコメントなら除外する
  function isCommentLine(content: string, index: number): boolean {
    const lineStart = content.lastIndexOf("\n", index - 1) + 1;
    const lineEndRaw = content.indexOf("\n", index);
    const lineEnd = lineEndRaw === -1 ? content.length : lineEndRaw;
    return /^\s*\/\//.test(content.slice(lineStart, lineEnd));
  }

  function listDirectCacheCalls(): Array<{ file: string; index: number; ignored: boolean }> {
    const files = listAppSourceFiles();
    const calls: Array<{ file: string; index: number; ignored: boolean }> = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(DIRECT_CACHE_CALL_PATTERN)) {
        if (isCommentLine(content, match.index)) continue;
        const ignored = IGNORE_COMMENT_PATTERN.test(precedingCommentBlock(content, match.index));
        calls.push({ file, index: match.index, ignored });
      }
    }
    return calls;
  }

  // 検出ロジック自体の健全性: 既知の固定キー呼び出し（pendingInviteQueryKey。
  // create.tsx/invite.tsx）を検出できていることを保証する（0件だと下の
  // itが何もチェックせず成功してしまう）
  it("固定キーを渡す既知の呼び出しを検出できている", () => {
    const calls = listDirectCacheCalls().filter((c) => !c.ignored);
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  // 【Rレビュー指摘】合計数だけを見ると、免除が増えても本来の対象が
  // 同じだけ減れば埋め合わされて気づけない（viewer-key-coverage.test.ts
  // 自身が過去に踏んだ形。MANUALLY_PLACED_CACHE_KEYSのarrayContaining
  // 化と同じ理由）。免除箇所そのものを名指しで固定する
  it("viewer-key-coverage-ignoreで免除されているのは想定どおりtimeline.tsxの1箇所だけである", () => {
    const ignored = listDirectCacheCalls().filter((c) => c.ignored);
    expect(ignored.map((c) => path.relative(repoRoot, c.file).replace(/\\/g, "/"))).toEqual([
      "apps/app/app/(tabs)/timeline.tsx",
    ]);
  });

  it("免除されていない呼び出しの近傍でviewerKeyを参照している", () => {
    const calls = listDirectCacheCalls().filter((c) => !c.ignored);
    for (const { file, index } of calls) {
      const content = readFileSync(file, "utf8");
      const start = Math.max(0, index - DIRECT_CACHE_CONTEXT_WINDOW);
      const end = Math.min(content.length, index + DIRECT_CACHE_CONTEXT_WINDOW);
      const context = content.slice(start, end);
      expect(
        context,
        `${path.relative(repoRoot, file)}（位置 ${index}）のqueryClient呼び出しの近傍にviewerKeyが見つかりません`,
      ).toMatch(/viewerKey/);
    }
  });
});

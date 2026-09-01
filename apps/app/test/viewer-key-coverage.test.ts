import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
interface ManuallyPlacedCacheKey {
  label: string;
  // グローバルフラグ付き正規表現であること（matchAllで全件拾うため）
  callPattern: RegExp;
}

const MANUALLY_PLACED_CACHE_KEYS: ManuallyPlacedCacheKey[] = [
  {
    label: "onboarding.pendingInvite",
    callPattern: /pendingInviteQueryKey\(/g,
  },
];
//
// 検証の粒度: 呼び出し箇所を含むファイルに`viewerKey`という識別子への
// 参照があることだけを見る（そのqueryKeyに実際に渡されているかまでは
// 見ない）。完全なAST解析はしないが、「対策そのものを丸ごと忘れる」という
// 主要なリスクは検出できる

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

// 手続き名（"couple.get"のような形）から、oRPCの呼び出しパターンを導出する
function orpcCallTarget(procedure: string): ManuallyPlacedCacheKey {
  const parts = procedure.split(".");
  if (parts.length !== 2) throw new Error(`想定外の手続き名の形式です: ${procedure}`);
  const [namespace, method] = parts;
  return {
    label: procedure,
    callPattern: new RegExp(`orpc\\.${namespace}\\.${method}\\.(queryOptions|infiniteOptions)\\(`, "g"),
  };
}

describe("ペアのデータ・利用者ごとのデータを読む問い合わせは、queryKeyにviewerKeyを含める（T9）", () => {
  const targetProcedures = [...findReadScopedProcedures(), ...MANUALLY_INCLUDED_PROCEDURES];
  // 「手続きの戻り値」（oRPC経由）と「利用者ごとに違う値を持つ、こちらが
  // 置いたキャッシュ」（MANUALLY_PLACED_CACHE_KEYS）の両方を、同じ形
  // （ラベル+呼び出しパターン）に揃えてから一括で検査する（A決定・PR #178）
  const targets: ManuallyPlacedCacheKey[] = [...targetProcedures.map(orpcCallTarget), ...MANUALLY_PLACED_CACHE_KEYS];

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

  // 呼び出し箇所ごとの近傍（前後CONTEXT_WINDOW文字）にviewerKeyがあるかを見る。
  // 【実測して2回訂正】
  // 1回目: 当初はファイル全体に`viewerKey`という文字列があるかだけを見て
  // いたが、1つのファイルに複数の呼び出しがあり、そのうち1つでも
  // viewerKeyを使っていれば（例: profile.tsxのcouple.get）、別の呼び出し
  // （同じファイルのme.get）からviewerKeyを丸ごと外しても検知できないことを
  // 実測で確認した（scripts/build-public.mjsのFALLBACK_LITERAL近傍チェックと
  // 同じ理由・同じ形の誤り）。
  // 2回目: 前後300文字の近傍チェックに直したが、これも実測すると見逃した。
  // `const viewerKey = useViewerQueryKey();`という宣言1行が、隣り合う
  // 2つの呼び出し（例: profile.tsxのme.get・couple.get）の両方から
  // 300文字以内に収まってしまい、片方だけ実際のqueryKeyから外れていても
  // 「宣言が近くにある」ことをもって素通りしていた。前後100文字まで
  // 縮めたところ、誤検知しないこと（正しいコードで緑）と、実際に不備を
  // 検知できること（me.getのqueryKeyだけからviewerKeyを外すと落ちる）の
  // 両方を実測で確認した
  const CONTEXT_WINDOW = 100;

  for (const target of targets) {
    it(`${target.label} を呼ぶ箇所は、それぞれの近傍でviewerKeyを参照している`, () => {
      const files = listAppSourceFiles();

      let totalMatches = 0;
      for (const file of files) {
        const content = readFileSync(file, "utf8");
        for (const match of content.matchAll(target.callPattern)) {
          totalMatches += 1;
          const start = Math.max(0, match.index - CONTEXT_WINDOW);
          const end = Math.min(content.length, match.index + match[0].length + CONTEXT_WINDOW);
          const context = content.slice(start, end);
          expect(
            context,
            `${path.relative(repoRoot, file)} の ${target.label} 呼び出し（位置 ${match.index}）の近傍にviewerKeyが見つかりません`,
          ).toMatch(/viewerKey/);
        }
      }

      // 【Rレビュー指摘R-2】callPatternが一致しなくなる（呼び出し方が変わる、
      // ラッパを噛ませる等）とtotalMatchesが0のままループが1度も回らず、
      // テストが「確認していないのに緑」になる。呼び出し箇所が実在することを
      // 要求することでそれを防ぐ
      expect(
        totalMatches,
        `${target.label} の呼び出し箇所が見つかりません（callPatternが実際の書き方と一致していない可能性）`,
      ).toBeGreaterThan(0);
    });
  }
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
  const DIRECT_CACHE_CALL_PATTERN = /queryClient\.(?:setQueryData|getQueryData)\(/g;
  const IGNORE_COMMENT_PATTERN = /viewer-key-coverage-ignore\b/;
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

  function listDirectCacheCalls(): Array<{ file: string; index: number; ignored: boolean }> {
    const files = listAppSourceFiles();
    const calls: Array<{ file: string; index: number; ignored: boolean }> = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(DIRECT_CACHE_CALL_PATTERN)) {
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

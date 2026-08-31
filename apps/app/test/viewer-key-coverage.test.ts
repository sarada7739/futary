import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ペアのデータを読む問い合わせ（apps/api/src/procedures/でreadProcedureを
// 使う手続き）は、クライアント側でqueryKeyに閲覧者の識別子（viewerKey。
// apps/app/lib/viewer-key.ts）を含めなければならない。含めないと、
// リロード無しで本物のログイン⇄ゲスト⇄未認証を切り替えたときに、直前の
// 別人のキャッシュが一瞬そのまま画面に出る（security-requirements.md T9。
// 共有端末では実質的な情報漏洩になる。実機で発生した不具合）。
//
// 手で一覧を並べて維持すると、新しい画面や新しい手続きを足したときに
// 対策を入れ忘れる（Rレビュー・A決定: 「手で並べず、定義を走査する形が
// 望ましい」。root-route.test.tsを32通りの総当たりにしたのと同じ考え方）。
// このテストはapps/api側の実際の定義（どの手続きがreadProcedureを使うか）
// を読み取ってから、apps/app側の呼び出し箇所を機械的に確認する。
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

describe("ペアのデータを読む問い合わせは、queryKeyにviewerKeyを含める（T9）", () => {
  const readScopedProcedures = findReadScopedProcedures();

  // 検出ロジック自体が壊れて0件になった場合、以降のitが1件も生成されず
  // 静かにテストが「何も確認していない」状態になる。それを防ぐ
  it("readProcedureを使う手続きを検出できている（検出ロジック自体の健全性）", () => {
    expect(readScopedProcedures.length).toBeGreaterThanOrEqual(5);
    expect(readScopedProcedures).toEqual(
      expect.arrayContaining(["couple.get", "stats.get", "memory.get", "post.list", "event.list"]),
    );
  });

  for (const procedure of readScopedProcedures) {
    it(`${procedure} を呼ぶ画面はviewerKeyを参照している`, () => {
      const parts = procedure.split(".");
      if (parts.length !== 2) throw new Error(`想定外の手続き名の形式です: ${procedure}`);
      const [namespace, method] = parts;
      const callPattern = new RegExp(`orpc\\.${namespace}\\.${method}\\.(queryOptions|infiniteOptions)\\(`);
      const files = listAppSourceFiles();

      const callingFiles = files.filter((file) => callPattern.test(readFileSync(file, "utf8")));

      for (const file of callingFiles) {
        const content = readFileSync(file, "utf8");
        expect(content, `${path.relative(repoRoot, file)} は ${procedure} を呼ぶがviewerKeyを参照していない`).toMatch(
          /viewerKey/,
        );
      }
    });
  }
});

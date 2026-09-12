import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// T7（039）: apps/app に `@futary/ui` から colors / shadow / gradients を import する
// 行が無い。静的 export を消したので型チェックが挙げるが、re-export や any 経由で
// 抜ける穴を塞ぐため、import 文を走査する既存の検査（viewer-key-coverage.test.ts）と
// 同じ道具（TypeScript の AST）で1本書く。
//
// 038 の教訓: 走査対象は「`@futary/ui` からの import 指定子」という閉じた集合。
// 「colors という識別子をどう手に入れたか」を追わない。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(testDir, "..");
const uiIndexPath = path.resolve(appDir, "../../packages/ui/src/index.ts");

// 039 で静的 export から外した名前。`useTheme()` から取る
const FORBIDDEN_NAMES = new Set(["colors", "shadow", "gradients"]);

// viewer-key-coverage.test.ts と同じ: 除外は apps/app 直下のこのパスだけ
// （名前の再帰的な一致はしない）
const EXCLUDED_TOP_LEVEL_DIR_NAMES = ["node_modules", ".expo", ".claude", "dist", "web-build", "test", "public", "assets"];
const EXCLUDED_ABSOLUTE_DIRS = new Set(EXCLUDED_TOP_LEVEL_DIR_NAMES.map((name) => path.join(appDir, name)));

function listFilesExcluding(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    if (EXCLUDED_ABSOLUTE_DIRS.has(fullPath)) return [];
    if (statSync(fullPath).isDirectory()) return listFilesExcluding(fullPath);
    return /\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts") ? [fullPath] : [];
  });
}

type Violation = { file: string; line: number; reason: string };

function importedNamesFromUi(sourceFile: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  const relative = (node: ts.Node) => ({
    file: path.relative(appDir, sourceFile.fileName),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  });

  for (const statement of sourceFile.statements) {
    // import { colors } from "@futary/ui" / import * as ui from "@futary/ui"
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@futary/ui") continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings) continue;
      if (ts.isNamespaceImport(bindings)) {
        // 名前空間 import は `ui.colors` のような参照を字面から追えなくする。
        // 今日の app には無い。増やさない
        violations.push({ ...relative(statement), reason: "名前空間 import（import * as）" });
        continue;
      }
      for (const element of bindings.elements) {
        // 別名（colors as c）は propertyName 側が本来の名前
        const original = (element.propertyName ?? element.name).text;
        if (FORBIDDEN_NAMES.has(original)) {
          violations.push({ ...relative(element), reason: `${original} を import している` });
        }
      }
    }
    // export { colors } from "@futary/ui" / export * from "@futary/ui"（re-export の穴）
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@futary/ui") continue;
      if (!statement.exportClause) {
        violations.push({ ...relative(statement), reason: "export * from（re-export）" });
        continue;
      }
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const original = (element.propertyName ?? element.name).text;
          if (FORBIDDEN_NAMES.has(original)) {
            violations.push({ ...relative(element), reason: `${original} を re-export している` });
          }
        }
      }
    }
  }
  return violations;
}

function parse(file: string, content = readFileSync(file, "utf8")): ts.SourceFile {
  return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

describe("T7: apps/app は @futary/ui から colors / shadow / gradients を import しない（039）", () => {
  it("apps/app 配下（test を除く）に違反が0件", () => {
    const violations = listFilesExcluding(appDir).flatMap((file) => importedNamesFromUi(parse(file)));
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("@futary/ui の import は最低1件は見つかる（走査ロジック自体の健全性）", () => {
    const files = listFilesExcluding(appDir);
    const uiImports = files.filter((file) =>
      parse(file).statements.some(
        (s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === "@futary/ui",
      ),
    );
    expect(uiImports.length).toBeGreaterThan(10);
  });

  it.each([
    ['import { colors } from "@futary/ui";', "colors を import している"],
    ['import { shadow as s } from "@futary/ui";', "shadow を import している"],
    ['import { Text, gradients } from "@futary/ui";', "gradients を import している"],
    ['import * as ui from "@futary/ui";', "名前空間 import（import * as）"],
    ['export { colors } from "@futary/ui";', "colors を re-export している"],
    ['export * from "@futary/ui";', "export * from（re-export）"],
  ])("違反の形 %s を検出する", (snippet, reason) => {
    const violations = importedNamesFromUi(parse(path.join(appDir, "app", "snippet.tsx"), snippet));
    expect(violations.map((v) => v.reason)).toEqual([reason]);
  });

  it.each([
    'import { useTheme, Text } from "@futary/ui";',
    'import type { Colors } from "@futary/ui";',
    'import { colors } from "./somewhere-else";',
  ])("許される形 %s は検出しない", (snippet) => {
    expect(importedNamesFromUi(parse(path.join(appDir, "app", "snippet.tsx"), snippet))).toEqual([]);
  });
});

describe("@futary/ui 自身が colors / shadow / gradients / themes を export していない（留め金の反対側）", () => {
  it("packages/ui/src/index.ts の export 指定子に禁止名が無い", () => {
    const sourceFile = parse(uiIndexPath);
    const exported: string[] = [];
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) exported.push(element.name.text);
      }
    }
    // themes（パレットの実体）も出さない: `themes.pink.colors` で静的に取れてしまう
    for (const name of [...FORBIDDEN_NAMES, "themes"]) {
      expect(exported, `index.ts が ${name} を export している`).not.toContain(name);
    }
    // 検査自体が動いている証拠: useTheme は export されている
    expect(exported).toContain("useTheme");
  });

  it("tokens.ts（export * の対象）に colors / shadow / gradients の宣言が無い", () => {
    const tokensPath = path.resolve(path.dirname(uiIndexPath), "tokens.ts");
    const sourceFile = parse(tokensPath);
    const declared: string[] = [];
    for (const statement of sourceFile.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) declared.push(decl.name.text);
        }
      }
    }
    for (const name of FORBIDDEN_NAMES) {
      expect(declared, `tokens.ts が ${name} を宣言している（export * で漏れる）`).not.toContain(name);
    }
    expect(declared).toContain("radius");
  });
});

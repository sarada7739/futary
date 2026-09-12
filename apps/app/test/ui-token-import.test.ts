import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
//
// 【R レビュー指摘（段階1）で塞いだ穴2つ】
// 1. `@futary/ui/src/theme` のようなサブパス import。`packages/ui/package.json` に
//    `exports` が無く `moduleResolution: "Bundler"` なので、`import { themes } from
//    "@futary/ui/src/theme"` は型チェックを通る（R が実測）。旧版は
//    `moduleSpecifier === "@futary/ui"` の完全一致で、サブパスは走査対象にすら
//    入らなかった。→ `@futary/ui/` 始まりは中身を問わず違反にする
// 2. 反対側（index.ts）の検査が `export *` の対象を `tokens.ts` に決め打ちしていた。
//    `export * from "./theme"` を足しても緑のままだった（R が実測）。
//    → index.ts の `export *` の対象を全部開き、そこで export されている名前を
//    再帰的に集めて禁止名が無いことを見る

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(testDir, "..");
const uiSrcDir = path.resolve(appDir, "../../packages/ui/src");
const uiIndexPath = path.join(uiSrcDir, "index.ts");

// 039 で静的 export から外した名前。`useTheme()` から取る
const FORBIDDEN_NAMES = new Set(["colors", "shadow", "gradients"]);
// index.ts 側ではパレットの実体（themes）も出さない: `themes.pink.colors` で静的に取れてしまう
const FORBIDDEN_EXPORTS = new Set([...FORBIDDEN_NAMES, "themes"]);

const UI_PACKAGE = "@futary/ui";
const UI_SUBPATH_PREFIX = `${UI_PACKAGE}/`;

function isUiSpecifier(text: string): boolean {
  return text === UI_PACKAGE || text.startsWith(UI_SUBPATH_PREFIX);
}

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
      if (!ts.isStringLiteral(statement.moduleSpecifier) || !isUiSpecifier(statement.moduleSpecifier.text)) continue;
      // サブパス（@futary/ui/src/theme 等）は index.ts の留め金を素通りするので、
      // 中身を問わず違反（R レビュー指摘）
      if (statement.moduleSpecifier.text !== UI_PACKAGE) {
        violations.push({ ...relative(statement), reason: `サブパス import（${statement.moduleSpecifier.text}）` });
        continue;
      }
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
      if (!ts.isStringLiteral(statement.moduleSpecifier) || !isUiSpecifier(statement.moduleSpecifier.text)) continue;
      if (statement.moduleSpecifier.text !== UI_PACKAGE) {
        violations.push({ ...relative(statement), reason: `サブパス re-export（${statement.moduleSpecifier.text}）` });
        continue;
      }
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

// 相対指定子（"./theme"）を packages/ui/src の実ファイルに解決する
function resolveRelativeModule(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((el) => (ts.isBindingElement(el) ? bindingNames(el.name) : []));
}

// あるファイルが外へ出す名前を全部集める。`export * from "./x"` は x を開いて再帰する。
// 型だけの export も区別せずに集める（弾いて損は無い）
function exportedNamesOf(sourceFile: ts.SourceFile, seen = new Set<string>()): { name: string; via: string }[] {
  if (seen.has(sourceFile.fileName)) return [];
  seen.add(sourceFile.fileName);
  const via = path.relative(uiSrcDir, sourceFile.fileName);
  const names: { name: string; via: string }[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.push({ name: element.name.text, via });
      } else if (!statement.exportClause && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveRelativeModule(sourceFile.fileName, statement.moduleSpecifier.text);
        if (!target) throw new Error(`${via}: export * の対象 ${statement.moduleSpecifier.text} を解決できない`);
        names.push(...exportedNamesOf(parse(target), seen));
      }
      continue;
    }
    if (!hasExportModifier(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        for (const name of bindingNames(decl.name)) names.push({ name, via });
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.push({ name: statement.name.text, via });
    }
  }
  return names;
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
        (s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === UI_PACKAGE,
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
    // R レビュー指摘: サブパスは中身を問わず違反
    ['import { themes } from "@futary/ui/src/theme";', "サブパス import（@futary/ui/src/theme）"],
    ['import { Text } from "@futary/ui/src/components/text";', "サブパス import（@futary/ui/src/components/text）"],
    ['import type { Theme } from "@futary/ui/src/theme";', "サブパス import（@futary/ui/src/theme）"],
    ['export { themes } from "@futary/ui/src/theme";', "サブパス re-export（@futary/ui/src/theme）"],
  ])("違反の形 %s を検出する", (snippet, reason) => {
    const violations = importedNamesFromUi(parse(path.join(appDir, "app", "snippet.tsx"), snippet));
    expect(violations.map((v) => v.reason)).toEqual([reason]);
  });

  it.each([
    'import { useTheme, Text } from "@futary/ui";',
    'import type { Colors } from "@futary/ui";',
    'import { colors } from "./somewhere-else";',
    // 名前が @futary/ui で始まるだけの別パッケージは対象外（前方一致ではなく "/" 区切り）
    'import { colors } from "@futary/ui-extras";',
  ])("許される形 %s は検出しない", (snippet) => {
    expect(importedNamesFromUi(parse(path.join(appDir, "app", "snippet.tsx"), snippet))).toEqual([]);
  });

  it("今日の apps/app に @futary/ui のサブパス import は1件も無い（R が git grep で確認した状態を固定）", () => {
    const subpathImports = listFilesExcluding(appDir).flatMap((file) =>
      parse(file).statements.filter(
        (s) =>
          (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) &&
          s.moduleSpecifier !== undefined &&
          ts.isStringLiteral(s.moduleSpecifier) &&
          s.moduleSpecifier.text.startsWith(UI_SUBPATH_PREFIX),
      ),
    );
    expect(subpathImports).toHaveLength(0);
  });
});

describe("@futary/ui 自身が colors / shadow / gradients / themes を export していない（留め金の反対側）", () => {
  it("index.ts が外へ出す名前（export * の対象を全部開いて再帰的に集めたもの）に禁止名が無い", () => {
    const exported = exportedNamesOf(parse(uiIndexPath));
    const offending = exported.filter((e) => FORBIDDEN_EXPORTS.has(e.name));
    expect(offending, JSON.stringify(offending)).toEqual([]);
    // 検査自体が動いている証拠: useTheme・radius（tokens.ts の export * 経由）が集まっている
    const names = new Set(exported.map((e) => e.name));
    expect(names.has("useTheme")).toBe(true);
    expect(names.has("radius")).toBe(true);
    expect(names.has("Screen")).toBe(true);
  });

  it("index.ts に `export * from \"./theme\"` を足すと themes が漏れて赤になる（R が実測した穴の再現）", () => {
    const content = readFileSync(uiIndexPath, "utf8") + '\nexport * from "./theme";\n';
    const exported = exportedNamesOf(parse(uiIndexPath, content));
    const offending = exported.filter((e) => FORBIDDEN_EXPORTS.has(e.name)).map((e) => e.name);
    expect(offending).toContain("themes");
  });

  it("theme.ts 自身は themes を宣言している（上の検査が「何も無いから緑」ではないことの根拠）", () => {
    const themeNames = exportedNamesOf(parse(path.join(uiSrcDir, "theme.ts"))).map((e) => e.name);
    expect(themeNames).toContain("themes");
    expect(themeNames).not.toContain("colors");
  });
});

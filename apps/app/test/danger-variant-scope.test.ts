import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 036: dangerバリアントは「取り返しがつかない操作」（退会）専用。
// 投稿の削除は論理削除で行が残るため対象外（architecture.md 7節
// 「danger を当てるのは、取り返しのつかないものだけ」）。
// タスク定義「テストで証明すること: dangerがdelete-account.tsx以外から
// 使われていない」を機械的に保証する

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(testDir, "..");

function listFilesRecursive(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
}

function listAppSourceFiles(): string[] {
  const targets = [path.join(appDir, "app"), path.join(appDir, "components")];
  return targets
    .flatMap((dir) => listFilesRecursive(dir))
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
}

describe("dangerバリアントはdelete-account.tsxだけで使う（036）", () => {
  it("variant=\"danger\"はdelete-account.tsxにしか出現しない", () => {
    // 【Rレビュー指摘】gフラグ付きの正規表現を.test()で複数ファイルに
    // 使い回すとlastIndexが前回の一致位置から進んだままになり、2件目以降の
    // ファイルがその位置より手前でしか一致しない場合に取りこぼす
    // （viewer-key-coverage.test.tsと同じ形のミュータブルな正規表現状態の
    // バグ）。ファイルごとに新しい正規表現を作るか、gを外して都度先頭から
    // 判定する。ここではgを使う理由が無い（1ファイルにつき有無だけ見る）
    // ためgを外した
    const pattern = /variant="danger"/;
    const filesWithMatch: string[] = [];

    for (const file of listAppSourceFiles()) {
      const content = readFileSync(file, "utf8");
      if (pattern.test(content)) filesWithMatch.push(path.relative(appDir, file).replace(/\\/g, "/"));
    }

    // 検出ロジック自体が壊れて0件になった場合、以降の検査が意味を失う
    expect(filesWithMatch.length).toBeGreaterThan(0);
    expect(filesWithMatch).toEqual(["app/(tabs)/delete-account.tsx"]);
  });
});

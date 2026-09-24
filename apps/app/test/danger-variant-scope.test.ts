import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// danger バリアントは取り返しがつかない操作（退会）専用（036）。投稿の削除は論理削除で行が残るので
// 対象外（architecture.md 7節「danger を当てるのは、取り返しのつかないものだけ」）。delete-account.tsx
// 以外から使われていないことを機械的に確かめる

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
    // g フラグ付きの正規表現を .test() で使い回すと lastIndex が進んだままになり、2 件目以降を取りこぼす。
    // 1 ファイルにつき有無だけ見るので g は付けない
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

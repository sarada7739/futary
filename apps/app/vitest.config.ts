import path from "node:path";
import { defineConfig } from "vitest/config";

// react-native のソースは Flow 構文を含み Metro（Babel）でしか変換できないため、
// Vitest では react-native-web（純粋な JS/ESM ビルド）にエイリアスして
// jsdom 上でレンダーする。アプリ本体が RN Web で単一コードベースになっている
// （architecture.md 1節）のと同じ考え方。
// テスト対象は packages/ui 配下のファイルも含む（workspace パッケージのため
// node_modules を持たない）。相対パスの "react-native-web" 指定だと importer の
// ディレクトリ基準で解決され失敗するため、apps/app の node_modules への
// 絶対パスを明示する
const reactNativeWebPath = path.join(import.meta.dirname, "node_modules", "react-native-web");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: reactNativeWebPath },
      // react-native-safe-area-context もネイティブモジュール（Flow構文）で
      // 同じ理由により変換できない。テスト用の最小モックに差し替える
      {
        find: "react-native-safe-area-context",
        replacement: path.join(import.meta.dirname, "test", "mocks", "react-native-safe-area-context.tsx"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
});

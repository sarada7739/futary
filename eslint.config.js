import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.expo/**",
      "**/.wrangler/**",
      "**/migrations/**",
      "**/.claude/**",
      "**/worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Expo/Metro/Wrangler設定ファイルはNode.jsのCommonJS環境で動く
    files: ["**/metro.config.js", "**/babel.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // CIから実行するNode.jsスクリプト（例: scripts/check-audit-ignore-staleness.mjs）
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // architecture.md 5節「日付計算は packages/date に置く」（L63）。
    // 011で todayJst が apps/app と apps/api の2箇所に同名で重複した反省から、
    // new Date()/Date.now() を packages/date の外で書けないようにする。
    // 規約に書くだけでは遡及しないことは Button の二重発火（L26）で経験済み。
    //
    // テストファイルは対象外（モックデータのタイムスタンプ生成であり、
    // JST の暦日計算そのものではないため）。Unix秒/ミリ秒をそのまま扱うだけの
    // 正当な用途（created_at・ULID・レート制限の時刻等）は、各呼び出し箇所で
    // 理由コメント付きの eslint-disable-next-line を明示する
    files: ["**/*.{ts,tsx}"],
    ignores: ["packages/date/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            "new Date() を packages/date の外で直接使わない（architecture.md 5節）。JSTの暦日計算はpackages/dateの関数を使う。Unix秒/ミリ秒をそのまま扱うだけなら、理由を明記してeslint-disable-next-lineする",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            "Date.now() を packages/date の外で直接使わない（architecture.md 5節）。JSTの暦日計算はpackages/dateの関数を使う。Unix秒/ミリ秒をそのまま扱うだけなら、理由を明記してeslint-disable-next-lineする",
        },
      ],
    },
  },
);

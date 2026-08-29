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
);

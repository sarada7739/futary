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
      // apps/landing + apps/app の web export を合成したビルド成果物
      // （scripts/build-public.mjs が生成する。ソースではない）
      "apps/api/public/**",
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
    // architecture.md 5節「日付計算は packages/date に置く」（L63・L64）。
    // 011で todayJst が apps/app と apps/api の2箇所に同名で重複した反省から、
    // new Date(...) を packages/date の外で書けないようにする。
    // 規約に書くだけでは遡及しないことは Button の二重発火（L26）で経験済み。
    //
    // Date.now() は数値を1つ返すだけで暦日を作らないため対象外
    // （タイムゾーンも日付境界も関与しない。created_at や ULID の種はこれで足りる）。
    // 暦・タイムゾーンの解釈が入るのは new Date(...) の方（getFullYear・
    // toISOString・toLocaleDateString等）で、ここが境界になる。
    // テストファイルも対象外（モックデータの固定値生成であり暦日計算ではない）。
    //
    // eslint-disable を並べて通す形にはしない。除外が増え続ける規則は、
    // いずれ本物の違反を隠す（conventions.md 8節でスクリーンショット要件を
    // 撤回したのと同じ理由）。必要な整形・計算は packages/date に関数として置く
    files: ["**/*.{ts,tsx}"],
    ignores: ["packages/date/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            "new Date(...) を packages/date の外で直接使わない（architecture.md 5節）。暦・タイムゾーンの解釈が必要な計算・整形は packages/date の関数を使う",
        },
        {
          // apps/app/lib/viewer-key.ts「readProcedureを使う手続き（couple.get・
          // stats.get等）はcoupleIdを引数に取らないため、TanStack Queryの
          // キャッシュキーだけでは誰が呼んだか区別できない」の帰結。
          // queryClient.setQueryData/getQueryDataにorpc.*.queryKey()を直接
          // 渡すと、viewerKeyを含まない固定キーになり、_layout.tsxのルート
          // ガード等が実際に読んでいる`[...queryKey, viewerKey]`という
          // キャッシュ枠とは別の場所に書き込む/読み取ることになる。
          // join.tsxがこれを踏み、招待コードで参加した利用者が(tabs)へ
          // 進めない不具合になった（PR #199。人間の実機報告まで
          // 気づけなかった）。ASTなら第1引数がorpcのメンバ呼び出しか
          // どうかを構文的に確実に判定できる（Rレビュー指摘）
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(setQueryData|getQueryData)$/] > CallExpression.arguments:first-child[callee.type='MemberExpression'][callee.property.name='queryKey']",
          message:
            "queryClient.setQueryData/getQueryDataにorpc.*.queryKey()を直接渡さない。viewerKeyを含まない固定キーになり、実際のキャッシュ枠（apps/app/lib/viewer-key.ts）と一致しない。invalidateQueries（前方一致でviewerKey付きの実キーも対象になる）を使うか、[...queryKey, viewerKey]の形で明示的にキーを組み立てる",
        },
      ],
    },
  },
);

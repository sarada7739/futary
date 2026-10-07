# 069: 依存の既知脆弱性に追随する（shell-quote・source-map-js・compression・sharp）

## 目的

**2026-10-07、CI の「pnpm audit（high以上で赤）」が落ちた**（A の記録の PR #485。コードは変えていない。新しい勧告の公開）。`pnpm audit` は critical 1・high 7（high のうち 4 は無視リストの image-size 2・node-forge・braces。新しいのは下表の 4 つ）。**4 つとも修正版がある**ので、無視リストには入れず上げる（`security-requirements.md` 9節）。

| 勧告 | パッケージ（今の版 → 修正版） | 経路（lockfile の親） | 使われる場面 |
|---|---|---|---|
| GHSA-pqg4-j6r4-53mv（**critical**） | `shell-quote` 1.10.0 → ≥ 1.11.0 | `react-devtools-core` | React Native の開発ツール |
| GHSA-68fv-2mgg-jv7q（high） | `source-map-js` 1.2.1 → ≥ 1.2.2 | `postcss`・`css-tree` | ビルド時の CSS の処理 |
| GHSA-vc2v-76pw-4v95（high） | `compression` 1.8.1 → ≥ 1.8.2 | `@expo/cli` | Expo の開発サーバ |
| GHSA-wq5f-xc86-pv6w（high） | `sharp` → ≥ 0.35.5 | `miniflare`（`wrangler` の中） | `wrangler dev`・テストの画像処理 |

どれも Worker と配信アセットには入らない（開発・ビルド時）。それでも、修正版があるものは上げる。

## 0. 決めたこと（A）

| # | 何 | 決定 | 理由 |
|---|---|---|---|
| 1 | 上げ方 | **まず lockfile の更新で上がるか**（`pnpm update -r --depth=Infinity shell-quote source-map-js compression sharp`。親の宣言の範囲に修正版が入っていれば上がる）。**上がらないものだけ**、親を上げる（`wrangler` が `sharp ≥ 0.35.5` を宣言する版があればそれ）か、`pnpm-workspace.yaml` の `overrides`（勧告・経路・到達可能性・消す条件のコメント付き。9節） | 9節の順（親を先に、上げられないときだけ override） |
| 2 | 範囲 | この 4 つだけ。moderate（esbuild・uuid・decode-uri-component）は触らない | 範囲を広げない |
| 3 | Dependabot の警告 | 上がれば自動で閉じる。閉じなければ報告に書く | |

## 1. B の作業

- 0節 #1。`pnpm audit` の前後（critical・high・moderate の数）を `artifacts/069/stage1.md` に。override を足したらその理由も

## 2. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | `node scripts/pnpm-audit.mjs --audit-level=high` が緑（high は無視リストの 4 件だけ）。陳腐化の検出も緑 | CI |
| T2 | lockfile に `shell-quote@1.10.0`・`source-map-js@1.2.1`・`compression@1.8.1`・`sharp` の 0.35.5 未満が無い | 報告（`grep`） |
| T3 | `pnpm -r test`・型チェック・lint が緑（件数が前と同じ）。`wrangler dev` で `/` と `/app/` が出る（sharp・miniflare を動かした場合） | CI・報告 |

## 完了条件

- T1〜T3
- `state.md` / `worklog.md`

## 停止条件

- どれかが親の固定で上がらず、override で上げると壊れる → A へ
- レビュー往復 3 回 → A へ

## 順序

**すぐ（最優先）。**main の CI がこれで赤い。

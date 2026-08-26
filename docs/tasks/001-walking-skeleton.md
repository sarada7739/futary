# 001: 歩くスケルトン

## 目的
機能を作る前に足回りを端から端まで通す。
これが無いと後続タスクがその場で基盤を作り、後で全部やり直しになる。

## 変更対象ファイル
- （新規）`package.json` / `pnpm-workspace.yaml` / `tsconfig.base.json`
- （新規）`apps/api/` — Worker、Hono、oRPC の最小構成、`wrangler.toml`
- （新規）`apps/app/` — Expo Router の最小構成
- （新規）`packages/contract/` — oRPC 手続き定義（`health.get` のみ）
- （新規）`packages/db/` — Drizzle 設定とマイグレーション基盤
- （新規）`.github/workflows/ci.yml`
- （新規）`.gitignore`（`.dev.vars`、`node_modules`、`dist`、`.wrangler` を含める）

## 実装内容
- pnpm workspace を構成する
- `packages/contract` に `health.get` を1本だけ定義する（戻り値 `{ ok: true, now: number }`）
- `apps/api` で Hono に oRPC ハンドラを載せ、`/api/*` で公開する
- D1 バインディングを設定し、`health.get` の中で `SELECT 1` を実行して疎通を確認する
- Drizzle のマイグレーション実行手順を確立する（空マイグレーション1本でよい）
- `apps/app` から TanStack Query 経由で `health.get` を呼び、結果を画面に表示する
- GitHub Actions で 型チェック → Lint → テスト を実行する

## 人間に依頼すること
以下は Claude では完了できない。B は着手前に人間へ依頼し、完了を待つ。
- Cloudflare アカウントで D1 データベースを作成し、`database_id` を受け取る
- Cloudflare アカウントで R2 バケットを作成する（007 で使う。ここで作っておく）

## 確認観点
- `pnpm install` からローカル起動までの手順が README に書かれ、その通りに動くか
- 型が `packages/contract` から `apps/app` まで通っているか（サーバの戻り値を変えるとクライアントの型が壊れるか）
- `.dev.vars` が `.gitignore` に入っているか
- CI がリポジトリ上で緑になっているか

## 完了条件
- [x] `apps/app` の画面に `health.get` の結果が表示される
- [x] D1 への疎通が確認できている
- [x] テストが1件以上あり緑
- [x] GitHub Actions が緑
- [x] `artifacts/001/` に動作証跡（起動ログ、画面のスクリーンショット、CI の結果）を保存
  ※画面のスクリーンショット画像は保存手段がなく未達。代わりに `get_page_text` で取得した
  画面テキストを `manual-check.md` に記録した（Rレビューで妥当と判定済み）

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [x] 人間に D1 / R2 の作成を依頼した
- [x] pnpm workspace の構成
- [x] `packages/contract` に `health.get` を定義
- [x] `apps/api` で Hono + oRPC が動く
- [x] D1 疎通
- [x] `apps/app` から呼んで表示
- [x] CI 構築
- [x] 証跡保存 → `state.md` 更新 → `worklog.md` 追記

## 実装メモ（Rレビュー向け）
- PR: https://github.com/sarada7739/futary/pull/1（ブランチ `task/001-walking-skeleton`）
- oRPC は contract-first。`packages/contract` が契約、`apps/api` が `implement()` で実装
- D1/R2 は作成済み。R2 は今回未使用（007で使う）
- 詳細は `artifacts/001/manual-check.md` の「途中でハマった点」を参照

### レビュー往復1回目（Rの指摘への対応）
- R-1（マイグレーション採番）: 対応済み。`0001_init.sql` を手書きしたため
  `meta/_journal.json` の連番と食い違っていた。ダミーテーブルで一度
  `drizzle-kit generate` を走らせて正しいジャーナル形式を得たうえで、
  ファイル名を `0000_init.sql` に、スナップショットを空に戻して整合を取った。
  次のテーブル追加で `0001_...` が正しく生成されることをシミュレーションで確認済み。
  ローカルD1にも `0000_init.sql` として再適用済み
- R-2（型基準の統一）: 対応済み。`apps/app/tsconfig.json` の `extends` を配列にし
  `["../../tsconfig.base.json", "expo/tsconfig.base"]` の順で両方継承。
  `tsc --showConfig` で `isolatedModules` / `noUncheckedIndexedAccess` /
  `forceConsistentCasingInFileNames` が効きつつ、Expo側の `module: preserve` /
  `customConditions` 等も保持されていることを確認。TypeScriptも `^5.9.3` に統一した
- R-4/R-5/R-6は記録のみとのことなので未対応（R-4は003着手時に要再確認）

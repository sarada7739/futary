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
- [ ] `apps/app` の画面に `health.get` の結果が表示される
- [ ] D1 への疎通が確認できている
- [ ] テストが1件以上あり緑
- [ ] GitHub Actions が緑
- [ ] `artifacts/001/` に動作証跡（起動ログ、画面のスクリーンショット、CI の結果）を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [ ] 人間に D1 / R2 の作成を依頼した
- [ ] pnpm workspace の構成
- [ ] `packages/contract` に `health.get` を定義
- [ ] `apps/api` で Hono + oRPC が動く
- [ ] D1 疎通
- [ ] `apps/app` から呼んで表示
- [ ] CI 構築
- [ ] 証跡保存 → `state.md` 更新 → `worklog.md` 追記

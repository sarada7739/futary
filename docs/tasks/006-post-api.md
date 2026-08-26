# 006: 投稿スキーマとAPI

## 目的
投稿の永続化と取得を用意する。UI と画像は別タスクに分ける。

## 変更対象ファイル
- （新規）`packages/db/schema/post.ts`
- （新規）`packages/db/migrations/xxxx_post.sql`
- （新規）`apps/api/src/procedures/post.ts`
- `packages/contract/` — `post.list` / `post.create` / `post.delete`

## 実装内容
- スキーマは `docs/architecture.md` 4節に従う。インデックス `(couple_id, created_at DESC)` を張る
- `post.list`: カーソルページング
  - 1回20件
  - **カーソルは `created_at` と `id` の複合**。同一秒の投稿が重複・欠落しないようにする
  - `deleted_at IS NULL` で絞る
  - `readProcedure` の上に載せる
- `post.create`: `body`（最大2000文字）と画像情報を受け取る。`writeProcedure` の上に載せる
  - この時点では画像は受け取るだけで、実際のアップロードは 007 で実装する
- `post.delete`: 論理削除（`deleted_at` を立てる）
  - WHERE 句に `couple_id = ctx.coupleId` を含めて1文で行う

## 確認観点
- カーソルページングで投稿の重複・欠落が起きないか（同一秒に複数投稿した場合を含む）
- 削除が論理削除になっており、一覧から消えるか
- 他ペアの投稿IDを指定した削除が失敗するか（005 のテストが維持されているか）
- 本文の長さ上限が効いているか

## 完了条件
- [ ] 投稿の作成・一覧・削除が動く
- [ ] 同一秒に3件投稿してもページングで重複・欠落しないテストが緑
- [ ] 005 の認可テスト4件が引き続き緑
- [ ] `artifacts/006/` にテスト結果を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [ ] スキーマ + マイグレーション
- [ ] `post.list`（複合カーソル）
- [ ] `post.create`
- [ ] `post.delete`（論理削除）
- [ ] ページングのテスト
- [ ] 証跡保存 → `state.md` 更新 → `worklog.md` 追記

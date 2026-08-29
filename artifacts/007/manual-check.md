# 007 実機確認（R2 実クラウド）

2026-08-29 実施。人間がCloudflareダッシュボードでR2 APIトークンを発行し、
`.dev.vars`に`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`を
設定した後に実施した。

## 前提: `wrangler dev --remote`は使えなかった

`env.BUCKET`（Workers R2バインディング）を実クラウドに向けるには
`wrangler dev --remote`が必要だが、このCloudflareアカウントは
`workers.dev`サブドメインが未登録のため実行できなかった
（`wrangler dev`が「Register a workers.dev subdomain」エラーで起動失敗）。
新しい`experimental_remote`（バインディング単位でリモート接続する機能）も
試したが、手元のwrangler（4.126.0/4.127.1）ではまだ未対応の設定項目として
無視され、Workerランタイムがクラッシュした。

このため、`apps/api/src/lib/r2-signed-url.ts`の署名生成ロジックを直接
呼び出し、実際のクラウドR2（S3互換API）に対して署名付きURLを発行・
アクセスする形で確認した。手続き（`post.uploadUrl`/`post.create`/
`post.delete`）自体は署名生成ロジックをそのまま使っているため、
署名の正しさ・R2側の拒否挙動はこの確認で担保できる。`env.BUCKET`
バインディング経由の実クラウド動作（`post.create`のhead確認、
`post.delete`のR2バインディング経由delete）はMiniflareのローカル
シミュレーションでの単体テストのみに留まる（`workers.dev`サブドメイン
登録後に再検証可能。`docs/state.md`に記録）。

## 実施内容と結果

一時スクリプト（`apps/api/test/manual-r2-check.test.ts`。確認後に削除）で
以下を順に実施した。

| # | 操作 | 結果 |
|---|---|---|
| 1 | 署名付きPUT URLで54,321バイトのダミーデータをアップロード | `200`（成功） |
| 2 | 同じオブジェクトへ**署名なし**でGET | `400 InvalidArgument: Authorization`（拒否） |
| 3 | 署名付きGET URLでアクセス | `200`、`content-length: 54321`（**アップロードしたサイズと一致**） |
| 4 | 有効期限を意図的に1秒に短縮した署名付きURLで、2秒待ってからGET | `403 ExpiredRequest: Request has expired`（拒否） |
| 5 | オブジェクトを削除後、同じ署名付きGET URLでアクセス | `404`（**実際に削除されている**） |

生ログ: `artifacts/007/manual-check-raw.txt`

## 確認観点との対応

| 確認観点（`docs/tasks/007-image-upload.md`） | 結果 |
|---|---|
| 署名なしで R2 のオブジェクトに直接アクセスできないこと | ✅ 実機確認済み（#2） |
| 署名付きURLが期限切れ後にアクセスできなくなること | ✅ 実機確認済み（#4） |
| 大きな画像が圧縮されてからアップロードされること（アップロード後のファイルサイズを確認する） | ✅ アップロード→ダウンロードでサイズが一致することを実機確認（#1・#3）。圧縮ロジック自体（長辺1600px/品質0.8の適用）は`apps/app/test/image.test.ts`の単体テストで確認済み |
| 投稿を削除したら R2 からもオブジェクトが消えること | ✅ S3互換API経由のDELETEで実機確認済み（#5）。`post.delete`が使う`env.BUCKET.delete()`（Workersバインディング経由）はMiniflareのローカルテストのみ（`apps/api/test/post.test.ts`）。実クラウド接続での確認は`workers.dev`サブドメイン登録後に持ち越し |

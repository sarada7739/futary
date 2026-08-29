# 007 実機確認（R2 実クラウド）

2026-08-29 実施。人間がCloudflareダッシュボードでR2 APIトークンを発行し、
`.dev.vars`に`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`を
設定した後に実施した。

## 前提（2026-08-29時点）: `wrangler dev --remote`は使えなかった

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

## 追記（2026-08-30）: `env.BUCKET`バインディング経由の実クラウド確認が完了

L34（`workers.dev`サブドメイン未登録）が解決し、`wrangler dev --remote`が
使用可能になった。人間の実機確認で`post.create`の`bucket.head()`経由の
実体確認は画像付き投稿の成功で確認できたが、**`post.delete`の
`bucket.delete()`経由の削除は別途確認が必要だった**（Rレビュー指摘）。
`post.delete`はR2削除に失敗しても成功として返す設計のため、削除経路が
機能していなくても投稿削除の見た目は成功する。

一時的なデバッグルート（`apps/api/src/index.ts`に`app.get("/api/_debug/
bucket-delete-check", ...)`を追加し、確認後に削除。007の
`manual-r2-check.test.ts`と同じ「一時スクリプト・確認後削除」の手法）で
`env.BUCKET.put()` → `head()`（存在確認）→ `delete()` → `head()`
（消滅確認）を`wrangler dev --remote`経由で実行した。

```
$ curl -s http://127.0.0.1:8787/api/_debug/bucket-delete-check
{"key":"_debug-check/59de2d39-52e6-4603-a379-58efe23b35e3.txt","existedBeforeDelete":true,"existsAfterDelete":false}
```

`existedBeforeDelete: true` → `existsAfterDelete: false`で、
`env.BUCKET.delete()`が実クラウドR2に対して正しく機能することを確認した。
これで`post.create`・`post.delete`双方の`env.BUCKET`バインディング経由の
実クラウド動作確認が完了した。

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
| 6 | `apps/app/lib/image.ts`と同じ形（`headers: {"content-type": "image/jpeg"}`）でPUTし、署名付きGETのレスポンスヘッダで`content-type`を確認 | PUT `200`、GET `200`かつ`content-type: image/jpeg`（**R2がContent-Typeを実際に保持することを確認**。Rレビュー指摘: 署名付きPUT URLはContent-Typeを署名で強制できないため、`post.create`の`head.httpMetadata?.contentType`検証が機能するには「クライアントがヘッダを送る」「R2がそれを保持する」の両方が必要。#6でその両方を実機で確認した） |

生ログ: `artifacts/007/manual-check-raw.txt`

## 確認観点との対応

| 確認観点（`docs/tasks/007-image-upload.md`） | 結果 |
|---|---|
| 署名なしで R2 のオブジェクトに直接アクセスできないこと | ✅ 実機確認済み（#2） |
| 署名付きURLが期限切れ後にアクセスできなくなること | ✅ 実機確認済み（#4） |
| 大きな画像が圧縮されてからアップロードされること（アップロード後のファイルサイズを確認する） | ✅ アップロード→ダウンロードでサイズが一致することを実機確認（#1・#3）。圧縮ロジック自体（長辺1600px/品質0.8の適用）は`apps/app/test/image.test.ts`の単体テストで確認済み |
| 投稿を削除したら R2 からもオブジェクトが消えること | ✅ S3互換API経由のDELETEで実機確認済み（#5）。`post.delete`が使う`env.BUCKET.delete()`（Workersバインディング経由）も2026-08-30に`wrangler dev --remote`で実クラウド確認済み（上記「追記」節参照。`existedBeforeDelete: true` → `existsAfterDelete: false`） |

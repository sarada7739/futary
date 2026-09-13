# 041 段階0: R2 は `response-content-disposition` を返すか

2026-09-13 / セッションB。タスク定義4節の 30 分の確認。**結果: 返る。(a) で進む。**

## やり方

`wrangler dev --remote` は立てず、`apps/api/.dev.vars` の R2 API トークンで本物の R2（`futary-images`）に対して
aws4fetch で直接署名した URL を Node から `fetch` した（`r2-disposition-check.mjs`。scratchpad に置いたので
リポジトリには無い。やったことは下のとおりで、同じことは `apps/api/test/r2-signed-url.test.ts` の
`createDownloadUrl` のテストと `apps/api/src/lib/r2-signed-url.ts` の実装で再現できる）。

1. `ListObjectsV2`（署名付き GET）でバケットにある既存のオブジェクトを 1 本選ぶ（読むだけ。書かない）
2. その鍵に `X-Amz-Expires=300` と `response-content-disposition=attachment; filename="futary-20260913-TESTIMAGEID.jpg"` を
   クエリに足してから `signQuery` で署名し、GET する
3. 対照として、クエリを付けずに署名した表示用 URL を GET する
4. 署名後に `response-content-disposition` の値を `evil.exe` に書き換えて GET する

## 結果

| | 応答 |
|---|---|
| 2. `response-content-disposition` 付きで署名 | **200。`content-disposition: attachment; filename="futary-20260913-TESTIMAGEID.jpg"`**（`content-type: image/jpeg`） |
| 3. クエリ無しで署名（表示用） | 200。`content-disposition` は**無い**（null） |
| 4. 署名後にクエリを書き換え | **403** |

- **クエリは署名に含まれる。**URL を持つ人も `filename` や `attachment` を書き換えられない（security-requirements.md 5節の前提が成り立つ）
- 有効期限 5 分（`X-Amz-Expires=300`）はそのまま効く

## 決めたこと

**(a)**: `createDownloadUrl(config, key, filename)`（`apps/api/src/lib/r2-signed-url.ts`）が `response-content-disposition` を
クエリに足してから署名する。Web は `<a href download>` を作ってクリックする（`apps/app/lib/photo-download.ts`）。新しいタブは開かない。

補足（撮影で分かったこと）: `<a download>` はクロスオリジンの URL ではブラウザが「遷移」として扱い、応答の
`Content-Disposition: attachment` を見て保存に切り替える。本番の R2 は上のとおり attachment を返すので保存になる。
**ローカルの wrangler dev では署名付き URL が本物の R2 を指し、実体はローカルの R2 にしか無いため 404 のページに遷移する**
（投稿画像がローカルで表示されないのと同じ既存の制約）。保存の実機確認は本番で人間が行う（完了条件のとおり）。

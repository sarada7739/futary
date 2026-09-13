# 041 段階1 — R のレビュー結果（一字一句）

conventions.md 8節「R のレビュー結果を `artifacts/NNN/review.md` に保存する」。B が保存した。要約していない。往復ごとに追記する。

## 往復 1 回目（2026-09-14。head c19c433）

R から B へ。PR #294（041 段階1、head c19c433）の判定: T1〜T15 は成り立っており、`couple_id` の留め金も実際に壊して赤になることを確かめた。**ただし必須修正 1 件（`album.removePhotos` が本番の D1 で落ちる形）。**直したコミットだけ見て確定する。A（#295 で定義を今の形に合わせた版）にも同文を送る。この文を `artifacts/041/review-stage1.md` に一字一句保存すること。

# 041 段階1（PR #294）— R の判定

futary-R で c19c433 を checkout して実行した。api 589（私の環境の既知 17 件を除き緑。041 のテスト 106 件は全部緑）・app 386・db 31・date 66・型・lint 緑。触ったものは全て戻した。

## 必須修正: `album.removePhotos` の 1 文の束縛パラメータが D1 の上限（100）を超える

`DELETE FROM album_photos WHERE album_id = ?1 AND id IN (?3, …) AND EXISTS(… ?2 …)` は photoIds の数 + 2 個のパラメータを 1 文に束ねる。契約は `photoIds` を 1〜100 で許しているので、**99 枚・100 枚を選んで削除すると 101・102 個になる。**Cloudflare D1 の制限は「Maximum bound parameters per query: **100**」（developers.cloudflare.com/d1/platform/limits/ を今日取得して確認）。ローカルの SQLite（miniflare）は 32766 まで通すので、テストでは見えない。本番だけで 500（withErrorId の ID 付き）になり、画面は「削除できませんでした」。

直し方（どれでも）: (1) `MAX_PHOTOS_PER_REMOVE` を 50 に下げ、画面は 50 枚ずつに分けて `removePhotos` を呼ぶ（60 枚読み込み → 「もっと見る」で 120 枚選べるので、契約の上限を超える選択も今は BAD_REQUEST で落ちる。分割すれば両方直る）、または (2) サーバ側で `photoIds` を 50 個ずつの DELETE に分けて `db.batch()` に入れる（1 文ずつの上限なので batch なら通る。ドキュメントに「上限は batch 内の各文に個別に適用」とある）。**私は (2) + 画面側の分割を勧める**（契約はそのまま。100 を超える選択は画面が 100 ずつ送る）。テスト: 100 枚を 1 回で消す本（ローカルでは通ってしまうので、文ごとのパラメータ数が 100 以下であることを SQL の `?` を数えて固定するか、batch の文の数を見る）。

`album.addPhotos` の batch（1 文 7 個）・`album.delete`・`me.delete`・既存 `post.ts` の IN 句（最大 21 個）は上限内。

## 留め金を壊して確かめたこと（`album.test.ts`・`r2-signed-url.test.ts` 34 件）

| 壊し方 | 結果 |
|---|---|
| `resolvePhotoRef`（post）から `couple_id` を外す | 赤 1 |
| `resolvePhotoRef`（album）から `couple_id` を外す | 赤 1 |
| `verifyUploadedImages` の実体確認を外す | 赤 2 |
| `addPhotos` の 500 上限を外す | 赤 1 |
| `update` の `coverPhotoId` アルバム内検査を外す | 赤 1 |
| `createDownloadUrl` から `response-content-disposition` を外す | 赤 2 |
| `album.delete` の写真 DELETE から `EXISTS(couple_id)` を外す | 赤 1 |
| `removePhotos` の DELETE から `EXISTS(couple_id)` を外す | **緑**（`fetchAlbumOrThrow` が先に couple で絞るので二重目。穴ではない） |
| `TIMELINE_SELECT` から `posts.deleted_at IS NULL` を外す | **緑**（下の記録 1） |

## 読んで確かめたこと

- 全手続きが `ctx.coupleId` で絞る。`album_photos` を触る文は全部 `albums` 経由で couple を確かめる（`updatePhoto`・`removePhotos`・`delete` は EXISTS、`addPhotos`・`update` は先に `fetchAlbumOrThrow`）
- `filename` は `futary-{JST日付}-{鍵の末尾}.jpg` でサーバ組み立て。鍵は ULID（`IMAGE_ID_PATTERN`）で `"`・`;` を含まない。クエリは署名に含まれる（段階0で 403 を実測）。クライアントは受け取った `url` と `filename` を `<a download>` に付けるだけ
- `album.create` は cover の実体確認 → `albums` + `album_photos` を 1 本の batch。`addPhotos` も全実体確認 → 1 本の batch（D1 の batch はトランザクション。途中で割れない）
- `me.delete`: `album_photos`（サブクエリ）→ `albums` → `invites` → … の順。`albums/` 接頭辞の削除も 2 経路とも入っている。T8 緑
- 画面ファイルで `appearance` を読んでいない（`album.tsx`・`album-detail.tsx`・`album-form.tsx`・`sheet.tsx`・`image-viewer.tsx`。grep で確認）。色の直書きも無い
- `apps/api/src` で `fetch(` は既存の `ai.ts`・`link-preview.ts` のまま（新しい外向きの口は無い）

## 記録（判定に使わない）

1. **`TIMELINE_SELECT` の `posts.deleted_at IS NULL` は、外してもテストが緑。**理由: `post.delete` が `post_images` を物理削除するので、削除済み投稿の写真行が存在せず、条件が効く場面が今は無い。`architecture.md` 4節「必ず含める」の条文は守られているが、テストは `post.delete` の連鎖を見ているだけで条件そのものを見ていない。効かせるには、`posts.deleted_at` を SQL で直接立てて `post_images` を残した状態で `photo.list` と `album.list` を見る 1 本。今日は到達不能なので必須にしない。A へ
2. 選択モードで 100 枚を超えて選んで削除すると、契約の上限で BAD_REQUEST → 「削除できませんでした」。必須修正の直し方 (2) + 画面の分割で同時に消える
3. 私の環境（`.dev.vars` 無し）では `apps/api` の結合テスト 17 件が main と同じく落ちる。041 のテストはその中に無い

## 私が確かめていないこと

- 本番 R2 での保存（段階0の実測と人間の手番に依る）・iPhone Safari・5 枚アップロード
- スクリーンショットは一覧を確認した（両モード × 10 種）が、1 枚ずつの目視はしていない

必須修正のコミットが積まれたら、そこだけ見て確定する。

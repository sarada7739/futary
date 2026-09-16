# 047（PR #391）— R の判定

futary-R で 177b653 を checkout して実行した（`.dev.vars` は CI と同じダミー）。ui 16・date 67・db 32・app 565・api 731 全部緑。`tsc --noEmit` 緑・`eslint .` 緑。`worklog.md` は追記のみ。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 壊して確かめたこと（`plan-lock` + `couple` + `album` 75 本）

| 壊し方 | 赤 |
|---|---|
| `source='stripe'`・`expires_at` 無しの free にも鍵（`updated_at` 起点） | 2 本（T1。0節 #11） |
| 猶予を 29 日に | 2 本（T1） |
| 新しい順に 30 枚を残す | 4 本（T2 ほか。0節 #2） |
| `couple_id` で切らない | 4 本（T9） |
| 鍵の写真にも URL を返す | 2 本（T2） |
| 鍵の写真の `downloadUrl` を許す | 1 本（T3） |
| 猶予中も鍵 | 4 本（T7） |
| カバーを鍵のまま返す | 2 本（T4） |
| **`unlockedPhotos` の `albums.deleted_at IS NULL` を外す** | **緑**（記録 2） |

## 読んで確かめたこと

- 判定は `lib/plan.ts` の `resolvePlanState` 1 箇所。`resolvePlan` はその `.plan`（045 の判定は変わらない）。起点は `lockOriginOf`（0節 #11 の 3 つ + どれでもない形は鍵なし）
- **署名付き URL の出口を全部見た**: album の写真の URL を作るのは `album.ts` の `toAlbumPhoto`（`photo.list`）・`toAlbum` の cover（`list/get/create/update/addPhotos/removePhotos`）・`photoDownloadUrl` の 3 系統。全部 `loadLock`（locked のときだけ先頭 30 を引く）を通る。`memory.ts`・`post.ts`・`want.ts` の `createGetUrl` は投稿・ほしいものの画像で、3 節「タイムラインへの鍵はしない」どおり
- `unlockedPhotos` は 1 文（`JOIN albums … deleted_at IS NULL WHERE couple_id ORDER BY taken_at, id LIMIT 30`。パラメータ 2 つ）。鍵の側の集合は作らない（0節 #13）。`photo.list` は「30 に無い」で判定
- `photo.downloadUrl`・`album.updatePhoto` の鍵は NOT_FOUND。`removePhotos` は通す（0節 #6）。`addPhotos` は 045 の `used`（鍵を含む）で PLAN_LIMIT（T6）
- カバーの倒し方: そのアルバムの鍵でない中で `taken_at, id` の最大。無ければ null。`photoCount` は鍵を含む
- `couple.get.planState`・`photoSchema.url` nullable + `locked`（契約）。app 側は `url` の無い写真をビューア・保存・ZIP に渡さない（`album-zip.test.ts` に 1 本）。B が決めた 4 つは定義と矛盾しない
- 0節 #12（T10）: `048/scripts/check-text.py` を自分で走らせて `terms`・`tokushoho` とも草案と**完全一致**（048 のときの「解約後のデータ」2 箇所の差が消えた）。`index.html` に「いつでも ZIP」無し
- `capture-locked.json`: `photo.list` 40 枚中 URL あり 30・locked 10。`pink-album-detail-locked-tiles.png` で鍵のマス（surface-tint + 鍵 + 「プレミアムで解放」）を見た

## 記録（判定に使わない。1・2 は A へ）

1. **「無制限」の文言が 045 の部品に残っている**（047 の差分ではない）: `plan-limit-sheet.tsx`「写真枚数 無制限」・`quota-warning-card.tsx`「プレミアムで無制限に」・`usage-card.tsx`「プレミアムで無制限に ›」。048 の 0節「『無制限』とは書かず『写真 N 万枚まで』」は `/premium` だけを P7 で見ていて、これらは網の外だった。**047 の鍵のマスを押すと出るのがこのシート**なので、鍵の画面の中で「無制限」と言う形になる（`pink-album-detail-locked-tiles.png` の 045 の警告カードにも「プレミアムで無制限に」が写っている）。特商法・LP の「50 万枚まで」とも食い違う。A が文言を決めて別の fix で（急ぎ）
2. `unlockedPhotos` の `albums.deleted_at IS NULL` は外してもテストが緑（045 の記録 1 と同じ形: `album.delete` が `album_photos` を物理削除するので、削除済みアルバムに写真行が残る場面が今は無い）。045 では #326 で「`deleted_at` を SQL で直接立てて数えないことを見る」1 本を足した。同じ扱いにするなら、削除済みアルバムの古い写真が 30 の枠を食って生きている写真に鍵が掛かる、を 1 本。A の判断

## 私が確かめていないこと

- 人間のペアでの確認観点（運営の SQL で `expires_at` を過去にして猶予 → 鍵 → paid に戻す）
- スクリーンショットは `pink-album-detail-locked-tiles.png` だけ見た

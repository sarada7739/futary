# 045（PR #325）— R の判定

futary-R で 3b1a24e を checkout して実行した。api 625（既知の環境起因 17 件を除き緑）・app 473・db 32・型チェック・lint 緑。`package.json`・`pnpm-lock.yaml` に差分無し。触ったものは戻した。

## B が見てほしいと言った 3 点

1. **`exceedsFreeQuota` の「数えてから書く」**: 2節が許した形どおり。`loadPlan` → paid なら数えない → `countAlbumPhotosUsed` → `used + adding > limit`。境界を `>=` に変えると「29 枚で 1 枚 → 入る」「29 枚で cover → ちょうど 30」が赤。超過は数枚で、物理上限（500・100）は別に守られている
2. **`PLAN_LIMIT` の判定順**: `create` は 100 件の `LIMIT_REACHED` より先、`addPhotos` は 500 枚の `LIMIT_REACHED` より先。`addPhotos` の 2 行を入れ替えると「PLAN_LIMIT は LIMIT_REACHED より先に見る」が赤
3. **ゲストが `couple.get` を読まない**: `album-detail.tsx` は `enabled: canWrite`（ゲスト・タイムラインで false）、`album.tsx` は `enabled: !isGuestMode`。ゲストで `couple.get` に行かない

## 壊して確かめたこと（plan / album / couple / me のテスト）

| 壊し方 | 赤 |
|---|---|
| 期限切れを paid のまま | 2 本 |
| 未知の `plan` を paid 扱い | 2 本 |
| 境界を `>=` に | 2 本 |
| `create` の `PLAN_LIMIT` を外す | 1 本 |
| `addPhotos` で `LIMIT_REACHED` を先に | 1 本 |
| `me.delete` から `couple_plans` を外す | 2 本（032 の網が拾う） |
| **`countAlbumPhotosUsed` から `albums.deleted_at IS NULL` を外す** | **緑**（記録 1） |

## 読んで確かめたこと

- 判定は `lib/plan.ts` の `resolvePlan` 1 箇所。行なし・`'free'`・未知・期限切れは全部 free。`couple_plans` は CHECK 無し（027・040・041 と同じ）
- `used` は 1 文（`album_photos JOIN albums` を `couple_id` で切る。`post_images` は見ない）。索引は `album_photos_album_taken_idx` の先頭列
- `couple.get` だけが `plan`・`albumQuota`（paid は null）を返す。`album.list`・`album.get` は変えていない。契約の他の手続きは `PLAN_LIMIT` を足しただけ
- `me.delete` の `couple_plans` は batch 内で `couples` の直前
- 文言: `premium.tsx`・シート・警告・使用量のカード・`lib/plan.ts` に「トライアル」「お試し」は無い。`30` の直書きも無い（`FREE_ALBUM_PHOTO_LIMIT` から）
- 切り替えの SQL は `plan-switch.md` にあり、ローカルで paid → free → paid を通した記録がある。本番の実行は人間の許可（0節 #12）

## 記録（判定に使わない。1 は A へ）

1. **`countAlbumPhotosUsed` の `albums.deleted_at IS NULL` は、外してもテストが緑。**T4 は `album.delete` で消しているが、`album.delete` は `album_photos` を物理削除するので、削除済みアルバムに写真行が残る場面が今は無い（041 の `posts.deleted_at IS NULL` と同じ形。A は #296 で「到達不能でも条文を試せる形」を選んだ）。同じ扱いにするなら、`albums.deleted_at` を SQL で直接立てて `album_photos` を残し、`countAlbumPhotosUsed` が数えないことを見る 1 本。A の判断
2. `couple.get` は `loadPlan` と `countAlbumPhotosUsed` の 2 クエリ増（free のときだけ後者）。実害無し

## 私が確かめていないこと

- 本番での free → paid の切り替え（人間の許可と実行）
- スクリーンショットの目視（ファイル一覧は見た）

---

#326（8d6815e）で記録 1 を閉じた（albums.deleted_at を直接立てて写真行を残し、used に数えないテスト。条件を外すと赤）。main 5cfac0c

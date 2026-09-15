# 055（PR #386）— R の判定

futary-R で ee3994a を checkout して実行した。api 694・app（premium/releases/home-releases 39）緑。`tsc --noEmit` 緑・`eslint .` 緑。差分は `MAX_ALBUMS_PER_COUPLE`・`PAID_ALBUM_PHOTO_LIMIT`・3.2.0・注釈・テスト・証跡。`worklog.md` は追記のみ。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 壊して確かめたこと

| 壊し方 | 赤 |
|---|---|
| `MAX_ALBUMS_PER_COUPLE` を 100 に戻す | 1 本（T1） |
| `PAID_ALBUM_PHOTO_LIMIT` を 50_000 に戻す | 1 本（T4） |

## 読んで確かめたこと

- 0節 #1: 件数だけ 1,000 に。`MAX_PHOTOS_PER_ALBUM` 500・`FREE_ALBUM_PHOTO_LIMIT` 30 は差分無し
- 0節 #2: `album.list` は 1 文（`ALBUM_SELECT`。枚数と表紙は相関サブクエリで、`album_photos_album_taken_idx` の先頭列で引ける）+ タイムラインの 2 文。パラメータは `couple_id` の 1 つなので D1 の 100 には当たらない。署名は手元の HMAC。T3 で 1,000 件（表紙 999）を返して 602KB。テストのファイル全体で 7 秒
- 0節 #4: 「5 万」が残るのは 3.1.0 の本文だけ（0節 #5「出したときの事実」どおり）。規約 8 節・045 のシートに枚数は無い（grep）
- 0節 #5: 3.2.0 の題・本文・`route` は定義どおり。3.1.0 は変わっていない
- 停止条件（500 に落とす）には当たっていない

## 記録（判定に使わない）

- アプリの一覧画面は 1,000 件のカードを 1 画面に出す（ページング無しの設計どおり）。実機で重いかは 1,000 件を作った人が見るまで分からない。今は要らない

## 私が確かめていないこと

- 実機

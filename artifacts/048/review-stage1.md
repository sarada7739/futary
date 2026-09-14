# 048 段階1（PR #338）— R の判定

futary-R で 06d3e23 を checkout して実行した。app 509 緑・`tsc --noEmit` 緑・`eslint .` 緑。CI pass。`fflate@0.8.2` の integrity は npm レジストリの値と一致（`sha512-cPJU47…`。依存 0）。lockfile の差分は fflate の 3 箇所だけ（Z6）。`git diff --stat` でサーバ・契約・DB に差分無し。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 壊して確かめたこと（`album-zip.test.ts` + `zip-export-sheet.test.tsx` 28 本）

| 壊し方 | 赤 |
|---|---|
| `fetch` に `signal` を渡さない | 2 本 |
| `captions.txt` を入れない | 5 本 |
| 全部のときに `albumId` 無しの `photo.list`（タイムライン）も呼ぶ | 2 本 |
| 失敗した枚を飛ばさず止める | 5 本 |
| 途中で閉じても `aborted` ではなく `saved` を返す | 2 本 |
| **`zipSync` の `level: 0` を外す（圧縮する）** | **緑**（記録 1） |

## 読んで確かめたこと

- 集め方: `photo.list` を `PHOTO_LIST_MAX_LIMIT`（60）で `nextCursor` が無くなるまで。全部は `album.list` の `items` だけ（契約の注記どおりページング無し・1 ペア 100 件上限なので取りこぼしは無い）。`photoCount === 0` は呼ばない
- `photo.downloadUrl` は readProcedure（ゲスト可）。`filename` はサーバが組み立てる ASCII。`album_photos.key` は UNIQUE なので、同じ ZIP・同じフォルダの中でファイル名は衝突しない
- 中断: `signal.aborted` を `downloadUrl` の前後で見て、`fetch` に `signal` を渡す。abort 中の例外は失敗に数えない（`signal.aborted` なら再送出）。画面は「やめる」・背景・`source` が null になる effect の cleanup、の 3 経路で abort。`abortRef` で二重開始を防ぐ。2 つ目の途中で止めても 1 つ目は `parts: 1` で残る
- 入口: 詳細の `⋯` は `!isTimeline`（ゲストも。`canSelect` が偽でも `⋯` だけ出る）。一覧の `⋯` は全員。マイページはプランのカードの中（ゲストのマイページには出ない）。B が決めた 5 点はタスク定義と矛盾しない
- `releases.ts` 2.2.0 の文言・route は 4節どおり
- `capture.json`: 1 アルバム 3 枚は route で返した見本と全バイト一致（`equal: true` × 3）。全部 104 枚は `1of2` = jpg 100 + captions 100 行、`2of2` = jpg 4 + captions 4 行。`r2Requests` 118
- `worklog.md` は追記のみ（削除行 0）。`state.md` は先頭に足して旧を残した形

## 記録（判定に使わない。1・2 は A へ）

1. **「無圧縮」のテスト（Z1 の `bytes > payload`）は `level: 0` を外しても緑。**中身が 1〜3 バイトの `0xff` で、圧縮しても縮まない。10KB の 0 埋めなど縮む中身にして「ZIP ≥ 中身の合計」を見れば赤になる。`level: 0` は CPU の話で動作には影響しない。後でよい
2. **`safeZipName` は `..`・`.` を通す**（実測: `".." → ".."`, `"  ..  " → ".."`）。題が `..` のアルバムは全部の ZIP で `../futary-….jpg` というパスになる（`zipSync` はそのまま書く。実測）。自分のデータの ZIP なので他人に害は無いが、展開ツールによって扱いが変わる。`/^\.+$/` を `"album"` に倒す 1 行で消える。題の中の TAB（zod は trim だけ）も `captions.txt` の区切りと衝突する。A の判断（B がこの PR で直しても、後でもよい）
3. 100 枚超は順に `<a download>` を押すので、Chrome の「複数ファイルのダウンロードを許可」は人間の実機で 1 度出る（B の報告どおり。定義どおり）

## 私が確かめていないこと

- 人間の iPhone・PC での実機（100 枚の ZIP が落ちるか）
- スクリーンショットは `white-album-list-zip-confirm.png` の 1 枚を見た（文言・分ける行・ボタンが定義どおり）。他はファイル一覧だけ

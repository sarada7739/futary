# 048 段階1: アルバムの写真を ZIP で持ち出す — 実装の報告

2026-09-14 / セッションB。タスク定義 `docs/tasks/048-premium-payment.md` の 2節（段階1）に従って実装した。
段階2（Stripe の決済）には触れていない。人間の iPhone・PC での実機確認はデプロイ後（100 枚の ZIP が iPhone で落ちるかもそこで見る）。

## 作ったもの（`apps/app` だけ。サーバ・契約・DB は変えていない）

| ファイル | 何 |
|---|---|
| `package.json` / `pnpm-lock.yaml` | `fflate@0.8.2` を足した（依存 0。lockfile の差分は fflate の 3 行だけ。**Z6**） |
| `lib/album-zip.ts` | `collectZipPhotos`（1 アルバム: `photo.list` を limit 60 で最後まで / 全部: `album.list` の items だけを辿る。タイムラインは呼ばない）・`exportZip`（`photo.downloadUrl` → `fetch(url, { signal })` → 100 枚ずつ `zipSync({ level: 0 })` → `<a download>`）・名前（`safeZipName`・`zipFileName`）・文言（`zipConfirmLabel`「38 枚を ZIP で保存します（約 15MB）」・`zipPartsLabel`）・`captionsText`・`saveZipFile`（Blob URL → `saveFromUrl`（041）→ 10 秒後に revoke） |
| `components/zip-export-sheet.tsx` | 「ZIP で保存」のシート。数える → 確認（枚数・概算・100 枚超なら「N つのファイルに分けて保存します」）→ 保存 → 「12 / 38 枚を取得中…」+ やめる → 「保存しました」+「N 枚は保存できませんでした」。閉じる・やめるで `AbortController.abort()` |
| `app/(tabs)/album-detail.tsx` | ヘッダーに `⋯`（編集・選択の隣。タイムライン以外の全員。ゲストも）→ メニューのシート「ZIP で保存」 |
| `app/(tabs)/album.tsx` | ヘッダーに `⋯`（＋ の隣。ゲストにも）→ メニューのシート「すべての写真を ZIP で保存」 |
| `app/(tabs)/profile.tsx` | プランのカードの下の行「アルバムの写真をまとめて保存 ›」→ 同じシート（全部） |
| `lib/releases.ts` | 2.2.0「アルバムの写真をまとめて持ち出せます」（4節の文言。`/album`。日付は main に入る日 = 2026-09-14 の想定。ずれたら直す） |

## テスト（Z1〜Z6）

| # | どこ | 何を |
|---|---|---|
| Z1 | `test/album-zip.test.ts` | 3 枚 → ZIP を `unzipSync` で開いて、枚数・ファイル名（`photo.downloadUrl` の `filename` そのまま）・中身のバイト・`captions.txt` の 3 行（パス TAB 説明文）の対応。無圧縮（ZIP が中身の合計より小さくならない）。名前 `futary-京都旅行-20260914.zip`。進捗 0/3 → 3/3 |
| Z2 | 同 | 101 枚 → `-1of2`（100 + captions）・`-2of2`（1 + captions）。進捗は全体で 101 まで |
| Z3 | 同 | fetch が 404 の枚・`photo.downloadUrl` が失敗した枚を飛ばして残りが入り、`failed` が 1。captions.txt にもその枚は無い。全滅なら `nothing` で ZIP を作らない |
| Z4 | 同 + `test/zip-export-sheet.test.tsx` | abort すると `fetch` に渡した `signal` が abort され、残りは取りに行かず `aborted`。2 つ目の途中なら 1 つ目は保存済みのまま（`parts: 1`）。画面: 「やめる」・背景を押す、のどちらでも signal が abort されて `onClose` |
| Z5 | 同 | 全部は `album.list` の items だけ。`albumId` の無い `photo.list`（タイムライン）が 1 つも無い。0 枚のアルバムは呼ばない。アルバムごとのフォルダ |
| Z6 | 目視 | `git diff pnpm-lock.yaml` は `fflate@0.8.2` の追加だけ |
| 画面 | `test/zip-export-sheet.test.tsx` | 閉じている間は何も呼ばない / 38 枚「約 15MB」/ 101 枚「2 つのファイルに分けて保存します」/ 0 枚「保存する写真がありません」/ 保存 → 完了（Blob URL と `<a download>` の名前）/ 全部の題と名前 / 失敗の 1 行 / 数えるのに失敗 |
| 入口 | `album-detail-screen.test.tsx`・`album-screen.test.tsx`・`profile-screen.test.tsx` | メンバー・ゲストに `⋯` がある。タイムラインには無い。`⋯` → 項目 → シートが開いて枚数が出る。マイページの行 → シート（ゲストのマイページには無い） |

`apps/app`: 45 ファイル 509 テスト緑（新規 `album-zip.test.ts` 17・`zip-export-sheet.test.tsx` 11・入口 3。2.2.0 で `releases.test.ts`・`releases-screen.test.tsx`・`home-releases.test.tsx` の固定値を更新）。`pnpm type-check`・`pnpm lint` 緑。

## fflate が Expo Web のバンドルで動くか（タスク定義 2節「先に確かめる」）

**動く。** `scripts/make-session.mjs`（ローカル D1 に paid のペア + 「京都旅行」3 枚（説明文 2 枚。1 枚は改行入り）+ 「沖縄/夏 2026」101 枚）→ `scripts/capture.mjs`（Playwright。expo web の本物のバンドル。**ローカルの署名付き URL は本物の R2 を指して 404 になるので、`r2.cloudflarestorage.com` への GET を `route` で受け止めて `packages/db/seed/assets` の JPEG を返した**）。落ちた ZIP を Node の fflate で開いて突き合わせた（`stage1/capture.json`）。

| 操作 | 落ちた ZIP | 中身 |
|---|---|---|
| 詳細の ⋯ → ZIP で保存（京都旅行・3 枚） | `futary-京都旅行-20260914.zip`（664,873 bytes） | jpg 3 + `captions.txt`（3 行。改行入りの説明文は空白に）。3 枚とも route で返した見本と**全バイト一致** |
| 一覧の ⋯ → すべての写真を ZIP で保存（3 + 101 = 104 枚） | `futary-albums-20260914-1of2.zip`（23,105,672 bytes。jpg 100 + captions 100 行）・`-2of2.zip`（932,637 bytes。jpg 4 + captions 4 行） | フォルダ `沖縄_夏 2026/`（`/` → `_`）と `京都旅行/`。確認「104 枚を ZIP で保存します（約 41MB）」「2 つのファイルに分けて保存します」。進捗「33 / 104 枚を取得中…」を撮った |
| マイページの行 | （開くところまで） | 「104 枚を ZIP で保存します（約 41MB）」 |

コンソールのエラーは `/app/fonts/poppins-*.woff2` の 404 × 30 だけ（dev サーバでは api の public に置くフォントが無い。既存。写真の 404 は route で受けたので無い）。

## スクリーンショット（`stage1/`。端末幅 390×844 @2x。PC 幅は 1280×900）

`pink-album-detail-menu`・`pink-album-detail-zip-confirm`・`pink-album-detail-zip-done`・`white-album-detail-menu`・`white-album-detail-zip-confirm`・`white-album-list-menu`・`white-album-list-zip-confirm`・`white-album-list-zip-progress`・`white-album-list-zip-done`・`white-profile-zip-row`・`white-profile-zip-confirm`・`white-album-detail-pc`

## B が決めたこと（A に知らせる）

- **全部のときは ZIP の中をアルバムごとのフォルダ（アルバム名を安全な文字にしたもの）に分けた。**タスク定義は中のファイル名を 041 の `filename` とだけ書いていて、フォルダの有無は書いていない。300 枚が平らに並ぶより分かる。`captions.txt` のパスもフォルダ付き。1 アルバムのときは直下（フォルダ無し）
- `captions.txt` の形は **1 行 1 枚「{ZIP 内のパス}<TAB>{説明文}」**（説明文が空でも行はある。説明文の改行は空白に）。UTF-8
- 全部のときの順は `album.list` の順（新しいアルバムから）。1 つの ZIP の中はアルバムの表示順（古い順）
- 100 枚超の ZIP は 1 つ組んでは `<a download>` を押す、を順に繰り返す（Chrome は 2 つ目で「複数のファイルのダウンロードを許可しますか」を聞く。タスク定義どおり「1 つずつ順に」）。途中で「やめる」と、それまでに落ちた ZIP は残る
- 確認の概算は 1MB 未満でも「約 1MB」
- `⋯` はタイムラインの詳細には出さない（タイムラインの ZIP は 5節「しない」）。ゲストには出す（一覧・詳細とも）
- `strToU8` の `Uint8Array` を `new Uint8Array(...)` で包み直している（jsdom で realm が違うと `zipSync` が入れ子のフォルダと読み違えた。ブラウザでは起きない。`photo-download.ts` の File と同じ形）
- Blob URL は `<a download>` を押してから 10 秒後に `revokeObjectURL`（直後に捨てるとブラウザによっては保存が始まらない）

## 停止条件の確認

- 「`fflate` がバンドルで動かない」→ 動いた（上の表。expo web の dev バンドル）
- 「50 枚でも iPhone で落ちる」→ 人間の iPhone で（デプロイ後）

## 人間に頼むこと（デプロイ後）

1. iPhone の Safari と PC で、1 つのアルバム（⋯ → ZIP で保存）と全部（一覧の ⋯ → すべての写真を ZIP で保存）が落ちること。iPhone は「ファイル」に入る
2. **100 枚超のアルバム（または全部で 100 枚超）で、1 つ目の ZIP（100 枚・30〜60MB）が iPhone で落ちるか。**落ちるなら `ZIP_PART_SIZE` を 50 に

## 人間の実機（2026-09-15。A 経由）

**OK。**iPhone・PC で ZIP が落ちた。100 枚の ZIP（049 で 100 枚を入れてから）も落ちた。`ZIP_PART_SIZE` は 100 のまま。

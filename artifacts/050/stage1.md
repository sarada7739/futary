# 050: タイムラインの 1 投稿を X くらいの高さに — 実装の報告

2026-09-15 / セッションB。タスク定義 `docs/tasks/050-timeline-density.md`。

## 実測（T5。390×844 @2x。`scripts/capture.mjs` → `stage1/capture.json`）

| 投稿 | ピンク | ホワイト | 備考 |
|---|---|---|---|
| **文字 1 行**（「今日はいい天気だったね」） | **94pt**（+ 間 8 = **102**） | **96pt**（+ 間 8 = **104**） | 目標 104 以下（0節 #1）。ホワイトは枠線 1px × 2 のぶん +2 |
| 横長 1 枚（1536×1024） | 324.7（画像 334×223・幅いっぱい） | 325.3（332×221） | 今までどおり（`post-images-single-full`） |
| 縦長 1 枚（1024×1536） | 462（画像 **240×360**・左 12 = カードの余白） | 464（240×360） | 高さ 360 に。幅は比率（360 × 2/3 = 240）。左寄せ（`post-images-single-capped`） |
| 4 枚 | 395.9 | 396.2 | 033 のまま（横一列の正方形） |
| カードの間 | 8・8・8 | 8・8・8 | 0節 #6 |
| ハートの当たり判定 | 44 | 44 | 並びの上では 28（`marginVertical: -8`） |

配分（B が決めた）: カードの余白 md（12）× 2 + 名前の行（sm・行間 20）+ 本文（md・行間 22）+ ハート（並びの上で 28）= 94。アバターは 36 で右の列（42）より低い。

**「X の 1 ポストと並べた 1 枚」**: `stage1/{pink,white}-one-line-vs-x.png`。人間の X の画面写真はリポジトリに無いので、A の定義の数字（X の 1 行の投稿 ≈ 100pt）を **高さ 100pt + 間 8 の青い物差し**にして文字 1 行のカードの横に置いた。カード 94（ピンク）は物差しより短い。

## 作ったもの

| ファイル | 何 |
|---|---|
| `packages/ui/src/components/card.tsx` | `padding?: SpaceToken`（既定 lg = 16。投稿カードは md = 12） |
| `packages/ui/src/components/button.tsx` | `compact?: boolean`: 文字 14/20・横の余白 sm・**上下の余白は md（12）のまま当たり判定 44 を保ち、`marginVertical: -8` で並びの上では 28**。`marginLeft: -8` で絵文字がアバターの左端に揃う。二重発火のガードは同じ（conventions.md 4節「Button を通す」を守った。生の Pressable にしていない） |
| `apps/app/components/post-card.tsx` | X の形: アバター（36）の右に **「名前 · 時刻」の 1 行**（`post-card-header-line`。sm。名前は太字・時刻は muted）、その直下に本文（gap 無し）。`⋯` は名前の行の右。画像は幅いっぱい（`marginTop: sm`）。ハートは `Button compact` |
| `apps/app/components/post-images.tsx` | `MAX_SINGLE_IMAGE_HEIGHT = 360`・`singleImageLayout(containerWidth, aspectRatio)`（幅を測る前は幅いっぱい。自然な高さ > 360 なら `{ width: 360 × 比率, height: 360, alignSelf: "flex-start" }`）。1 枚のときも外側の View の `onLayout` で幅を測る。2〜4 枚は触っていない |
| `apps/app/app/(tabs)/timeline.tsx` | カードの間を `ItemSeparatorComponent` の sm（8）だけに（`contentContainerStyle` の `gap` も足すと区切りの前後に二重に掛かり、実測 20 になった） |
| `apps/app/lib/releases.ts` | 2.3.0「タイムラインをすっきりさせました」（0節 #12。`/timeline`） |

## テスト（T1〜T4）

| # | どこ | 何を |
|---|---|---|
| T1 | `test/post-card.test.tsx` | `post-card-header-line` の中に「投稿者 · たった今」。本文は同じ列（親の textContent が「投稿者 · たった今本文です」） |
| T2 | 同 | ハートの `paddingTop/Bottom` 12・`marginTop/Bottom` -8・文字 14/20（= 当たり判定 44・並び 28）。押すと `onToggleReaction("heart")` |
| T3 | 同 | `singleImageLayout`（326 幅: 4:3 → full / 3:4 → capped 270×360 左寄せ / 0 幅 → full / ちょうど 360 → full）。部品: 横長は測ったあとも幅 100%・aspectRatio。縦長は測る前は full、`__reactLayoutHandler`（react-native-web が要素に付ける layout ハンドラ。jsdom では onLayout が発火しないので直接呼ぶ）で 326 を渡すと `capped`・高さ 360・幅 270・`alignSelf: flex-start` |
| T4 | 同 + 既存 | 2 枚は `post-images-row` のまま・1 枚の上限は掛からない。033・041 の既存テストは緑のまま |
| 版 | `releases.test.ts`・`releases-screen.test.tsx`・`home-releases.test.tsx` | 2.3.0 に更新 |

`pnpm -r test`: ui 16・date 66・db 32・app 533・api 626 緑。`pnpm type-check`・`pnpm lint` 緑。

## スクリーンショット（`stage1/`）

`{pink,white}-timeline`（表示領域）・`{pink,white}-timeline-full`・`{pink,white}-one-line-vs-x`。`make-posts.mjs` の投稿 4 件（4 枚 / 横長 1 枚 / 縦長 1 枚 / 文字 1 行）。画像は route で見本の JPEG。

## B が決めたこと（A に知らせる）

- **`hitSlop` は使っていない。**react-native-web の `Pressable` は `hitSlop` を DOM に反映しない（`dist/exports` で `hitSlop` を扱うのは `Touchable` だけ。実測ではなくソースを読んだ）。当たり判定 44 は Button の上下の余白 12 で作り、`marginVertical: -8` で並びの高さを 28 にした（T2 の「hitSlop か minHeight」の後者に近い形）
- ハートの行は本文の直下（gap 無し。余白 4 が見た目の間になる）
- 名前の行は sm（14/20）。本文は md（16/22）のまま。アバター 36 のまま
- 画像（1 枚も 2〜4 枚も）はアバターの下にも掛かる幅いっぱい（0節 #7「幅いっぱいで収まればそのまま」）。X のように右の列に寄せていない
- `memory-card.tsx` は `PostImages` を使っているので **1 枚の高さ 360 の上限は思い出カードにも掛かる**（0節 #10「同じ部品を使っているなら同じに変わる」）。カード自体の余白・名前の行は思い出カード独自のもので触っていない
- `Card` の `padding` は prop で（`packages/ui`。既定は lg のまま。他のカードは変わらない）

## 見つけたこと（050 ではない。A へ）

- 4 枚の横一列（033）が **読み込み直後に一番右までスクロールした状態**で出ることがある（Playwright の実測: `scrollLeft` 834〜854 = 末尾。**main（050 の前）でも同じ**。`scripts/` には含めていない使い捨ての計測）。人間の実機でどう見えているかは未確認。050 の差分では触っていない

## 人間に頼むこと（デプロイ後）

- iPhone のタイムラインで「X くらい」と言えるか。縦長の写真が高さで揃って左に寄っているか

## fix: 長い名前で時刻が切れる（R の記録 3。A の判断で fix）

名前と時刻を別の `Text` にして `row` に並べ、名前を包む View に `flexShrink: 1`・`minWidth: 0`、時刻を包む View に `flexShrink: 0`。名前だけ 1 行で省略され、時刻は常に描かれる。T1 に「全角 30 文字の名前でも時刻が描画される」を足した。
本物のバンドルで実測（390pt。名前を全角 30 文字にして）: 名前の幅 195（省略あり）・時刻 68（右端 335 < カードの右端 374）・文字 1 行のカードの高さは 94 のまま（`stage1/pink-long-name.png`）。

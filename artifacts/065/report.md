# 065: LP の AI まとめの帯、スマホで文字を上下の真ん中に

`docs/tasks/065-ai-band-center-on-phone.md`。

## タスク定義の 2 行だけでは動かなかった（1 行足した）

0節 #1・#2 のとおり `.ai-band` を `justify-content: center`、`.ai-band-copy p` に `text-wrap: balance` にして測ったが、**375 幅の文字の位置は変わらなかった**（帯 200px の中で文字は上 24・下 84 のまま）。

原因: `.ai-band-copy` が `flex: 1 1 auto`。720px 以下の縦並び（`flex-direction: column`）では、文字の塊が帯の高さいっぱい（`min-height: 200px`）に伸び、文字はその箱の上端に置かれる。子が伸びきっているので `justify-content` は位置に効かない（`space-between` でも `center` でも同じ）。

足した 1 行: 720px 以下で `.ai-band-copy { flex-grow: 0; }`（伸ばさない）。PC の横並びは触らない。0節 #1 の `justify-content: center` はそのまま（これが縦並びで効くようになる）。

## 測った値（`node artifacts/065/scripts/measure.mjs <outDir> [css]`・Chromium・file:// の index.html）

| 幅 | 帯の高さ | 文字の上・下の余白 | 説明の行数 |
|---|---|---|---|
| 375（main） | 200 | 24・84 | 2（「…振り / 返ります。」） |
| 375（タスク定義の 2 行だけ） | 200 | 24・84 | 2 |
| **375（この PR）** | 200 | **54・54** | 2（「ふたりの 1 週間と 1 ヶ月 / を、AI が短く振り返ります。」） |
| 1280（main） | 200 | 64・64 | 1 |
| **1280（この PR）** | 200 | **64・64** | 1 |

1280 幅は main と画素で比べて差分なし（PIL の `ImageChops.difference` の bbox が None）。

画面: `ai-band-375.png`・`ai-band-1280.png`（帯だけを 2 倍で）。

## T1

`apps/api/test/landing.test.ts` の「065 T1」2 本:
- `.ai-band` に `justify-content: center`（`space-between` が無い）・`.ai-band-copy p` に `text-wrap: balance`
- 720px 以下の縦並びで `.ai-band-copy` に `flex-grow: 0`（この行を `1` に戻すと赤になるのを確かめて戻した）

`pnpm -r test`: ui 23・date 68・db 34・app 630・api 782（+2）= **1,537**。type-check・lint 緑。

## 人間の手番

本番デプロイの後、iPhone の Safari で帯を見る（Safari は Chromium と別。`text-wrap: balance` は Safari 17.5 以降）。

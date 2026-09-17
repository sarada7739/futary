# 062 段階1: ピンクの機能パネルにも写真タイル（ホワイトと同じ形に）

`docs/tasks/062-pink-panel-photos.md`。部品 1 つとテスト 2 つ。`index.tsx`（グリッド・9 枚の順）・`assets.ts`・`releases.ts` は触っていない。

## 変更

- `apps/app/components/feature-panel.tsx`: 1 つの形に書き直した（0節 #1〜#5）
  - 白いカード（`colors.surface` + `borderWidth: 1` + `colors.border` + `shadow.card`）の中に、正方形の写真タイル（`aspectRatio: 1`・`radius.input`・地は `colors.surfaceTint`）+ 日本語ラベル（2 行ぶん 32 を常に確保）+ 注記の行（14 を常に確保。使えないものは「近日公開」）
  - `photo` が無ければタイルの中に線画アイコン（28・`tintColor: colors.brandInk`）
  - 消した: `PanelSurface`・`CARD_HEIGHT`（113）・「COMING SOON」・`opacity: 0.7`・`WhitePanel`・`WHITE_*`・`appearance` の読み取り。`testID="feature-panel-white"` → `feature-panel`。`feature-panel-photo` はそのまま
  - 先頭のコメントは現在の形の説明だけに
- `apps/app/test/white-stage2.test.tsx`: 既存の white の 3 本を `feature-panel` に。「pink では COMING SOON」を反転して pink の 3 本（写真あり・使えるパネル・写真なし）。T2（ソースに `appearance` の読み取りが無い。コメントは除いて見る。`COMING SOON`・`feature-panel-white` も無い）
- `apps/app/test/home-screen.test.tsx`: T3（ホームに `feature-panel-photo` が 9 つ）

## テスト

| # | 何を | 結果 |
|---|---|---|
| T1 | pink: `photo` あり → `feature-panel-photo`。無し → 無い。使えないものは「近日公開」で「COMING SOON」は無い。使えるものには「近日公開」も無い。white の 3 本は名前を替えて緑のまま | 緑 |
| T2 | `feature-panel.tsx` のコード（コメントを除く）に `appearance` が無い | 緑 |
| T3 | ホーム（pink）に `feature-panel-photo` が 9 つ | 緑 |
| T4 | 「COMING SOON・準備中です・次フェーズ」が出ない（既存） | 緑 |

`apps/app` vitest 53 ファイル 630 件 緑・`tsc --noEmit` 緑・eslint 緑。

## 画面（`artifacts/062/`。375×812・DPR 2。`scripts/capture.mjs`）

| ファイル | 内容 |
|---|---|
| `pink-home.png` / `pink-home-viewport.png` | ピンク。9 枚とも写真タイル。カードに影あり（`shadow.card`）、枠線は地とほぼ同色 |
| `white-home.png` / `white-home-viewport.png` | ホワイト。変わっていない（写真タイル + 枠線・影なし） |
| `capture.json` | 計測値 |

`capture.json`（両外観とも同じ寸法）: パネル 9・写真 9・カード 105×159・タイル 91×91（正方形）。ピンクの枠線 `rgb(242,224,220)`・影 `rgba(0,0,0,0.08) 0 8px 24px`、ホワイトの枠線 `rgb(210,210,215)`・影なし。「COMING SOON」「近日公開」はどちらにも無い（9 枚とも使える）。`consoleErrors` 0。

停止条件の「`surfaceTint` の上で写真の縁が浮く」は見えなかった（写真は `cover` で正方形いっぱい）。

## 気づき（判断は A・人間）

- カードの高さは 113 → 159（375 幅。0節 #7 の見積もり 142 は幅 76 のとき。実測のグリッド幅では 105 幅でタイルが 91）。3 行で 3×159 + 12×2 = 501px。ホームの `ReleaseButton` が下がる（0節 #7「それでよい」）
- 9 枚とも使えるので注記の行（14px）は常に空。0節 #1 の「高さは常に確保」のとおり残してある

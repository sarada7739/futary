# 062 段階1 — R の判定

futary-R で origin/task/062-pink-panel-photos（0e4ee35）を checkout。`white-stage2.test.tsx`・`home-screen.test.tsx` 29 件 緑・`tsc --noEmit` 緑。`worklog.md` は追記のみ（削除 0 行）。

**受け入れ。必須修正なし。**

## 差分で確かめたこと（0節との突き合わせ）

- #1・#2: `FeaturePanel` は 1 つの形（`surface` + 1px `border` + `shadow.card` のカード → `aspectRatio: 1` の `surfaceTint` のタイル → ラベル 2 行分 → 注記 1 行分）。`useTheme()` から取るのは `colors` と `shadow` だけ。`appearance` の読み取りは無い（T2 がコメントを除いて固定）
- #3: 「COMING SOON」・`opacity` の仕組みは消えている。`apps/app` のコードに `COMING SOON`・`feature-panel-white`・`WhitePanel`・`PanelSurface` が残っていない（残るのはテストの否定と `+html.tsx` のフォントのコメントだけ）
- #4: `photo` 無しはタイルの中に線画（`ICON_SIZE` 28・`brandInk`）
- #5: `CARD_HEIGHT`・`WHITE_*` を消し `PANEL_*` に。`testID` は `feature-panel`
- #6・#8: `index.tsx`・`assets.ts`・`releases.ts` は差分に無い
- `pink-home-viewport.png`: 9 枚とも写真タイル。ラベル・注記の高さが揃っている。ホワイトは B の報告どおり変わらず

## 記録（判定に使わない）

1. 使えるパネルの注記の行（空の 14px）がカードの下の余白に見える。0節 #1 の「高さは常に確保」どおりで、今は 9 枚とも使えるので全カードが同じ。任意

## 私が確かめていないこと

- 本番のピンクのホーム（人間の手番）

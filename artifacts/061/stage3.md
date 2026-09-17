# 061 段階3: ガラス板の `filter: url()` も外す（Safari はぼかしだけの曇りガラス）

段階2（#422。`backdrop-filter: url()` の層を消す・`tablist` を `zIndex: 1`）をデプロイした後（`a4a942e`。16:14Z に成功）、人間が iPhone Safari のピンクのタイムライン（写真のある投稿）で撮り直した画面（2026-09-18。`C:\Users\coco7\.claude\uploads\…\26a050e2-image.png`）:

- ホームとカレンダーのアイコンと文字が**二重にずれて**見える
- バーの上端に沿った**帯**が残る

R が段階2 で決めていた次の手のとおり、ガラス板 `glass-sheet` の `filter: url(#…)` も外した。

## 変更

- `apps/app/components/glass-tab-bar.tsx`: `glass-sheet` の `filter` / `WebkitFilter` を消した。板は色（`tint`）と斜めのグラデーションだけ。冒頭のコメントを段階2・3 の経緯込みの今の前提に。残る層はぼかし（blur + saturate）・板・色収差（ピンクだけ）・フチ。**この部品に `url(` は無い**
- `apps/app/test/glass-tab-bar.test.tsx` G5: 「`filter` / `WebkitFilter` の宣言も無い。コード（コメントを除く）に `url(` が無い」を足した。前の「屈折は `filter` だけ」の断言は消した
- `+html.tsx` の SVG フィルタの定義と `theme.ts` の `filterId`（G6）は触っていない（もう参照されない。消すかは A の判断）

## テスト

`apps/app` vitest 53 ファイル 627 件 緑（`glass-tab-bar.test.tsx` 15 件）・`tsc --noEmit` 緑・eslint 緑。

## 画面（`artifacts/061/stage3/`。Chromium。390×844・DPR 2）

段階1・2 と同じ 8 枚 + `capture.json`。4 通りとも `fabOverhang` 12・`tablistChildren` 5・`tabCount` 4。Chromium ではぼかしとフチだけの曇りガラス（板の歪みは無くなった）。

## B が確かめていないこと

- **iPhone Safari の実機。**マージ・デプロイ後に人間が同じ画面をもう一度撮る。これでも二重化・帯が残るなら、残る候補はピルの `backdrop-filter: blur() brightness() saturate()` と色収差の `inset` の影（段階4。判断は R・A）

## A へ

- `+html.tsx` の SVG フィルタの定義・変位マップと `theme.ts` の `Glass.filterId` は参照されなくなった。消すなら A の判断（タスク定義 0節 #3・#4 の書き換えと一緒に）

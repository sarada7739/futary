# 061 段階2: iPhone Safari で壊れた 2 箇所の修正

人間が実機（iPhone Safari）で見た 2 つの壊れ（R が拡大して読んだ）:

- ピンク: バーの上端と下端に赤い帯。＋の FAB の下半分がバーに覆われる
- ホワイト: バーの上端に沿って点線のような縞

R のローカル（Playwright の WebKit）では出ない。headless の WebKit は `backdrop-filter` を描画しないので Safari の再現にならない（`review-stage1.md` 末尾）。

## 変更（R の推定と人間の指示のとおり。判断は人間）

1. **屈折の層 `glass-refraction`（`backdrop-filter: url(#…)`）を消した。**前提「WebKit は `url()` を含む宣言ごと捨てる」が実機で成り立たず（`CSS.supports` も true を返す）、Safari はこの層を処理して壊れた絵を出していた。`supportsBackdropUrl()`・`refracting`・`useMemo` も要らなくなったので消した。Chromium の「背景そのものの屈折」は失うが、ガラス板側の歪み（`glass-sheet` の `filter: url()`）とぼかし（`glass-blur`）は残る。冒頭のコメントを今の前提に書き換えた
2. **`tablist` の `View` に `zIndex: 1`。**`backdrop-filter` を持つ兄弟（GlassPane）が後に描くタブの列の上に来る WebKit の重なり順の癖を抑える。タブの列と FAB がガラスの層の上に来ることを固定する
3. テスト G5 を反転: 「`backdropFilter` / `WebkitBackdropFilter` の宣言に `url(` が無い（ぼかしの層もレンズも）。屈折は `filter` だけ。`glass-refraction` が無い」＋「`tablist` の行に `zIndex: 1`」。ソースの文字列検査のまま
4. `artifacts/061/scripts/capture.mjs` の `layers` から `refraction` を外した

`theme.ts`・`+html.tsx`・`_layout.tsx` は触っていない（SVG フィルタの定義はガラス板の `filter: url()` が使う）。

## テスト

`apps/app` vitest 53 ファイル 626 件 緑（`glass-tab-bar.test.tsx` 14 件 + `tab-pill.test.ts` 17 件）・`tsc --noEmit` 緑・eslint 緑。

## 画面（`artifacts/061/stage2/`。Chromium。390×844・DPR 2）

| ファイル | 何 |
|---|---|
| `chromium-{pink,white}-{home,bar,home-scrolled,calendar}.png` | 段階1と同じ 8 枚。FAB がバーの上に全部見える。ぼかしと板の歪みは残っている |
| `capture.json` | 計測値 |

`capture.json`: 4 通り（2 外観 × 2 画面）とも タブバー h=64・下余白 16・`tablistChildren` 5・`tabCount` 4・`fabOverhang` 12（段階1と同じ）。`layers` は blur・sheet・rim が true、aberration はピンク true / ホワイト false。`glass-refraction` は無い。

## B が確かめていないこと

- **iPhone Safari の実機。**headless の WebKit では再現しない（R の記録）。マージ・デプロイ後に人間が同じ 2 画面をもう一度撮る
- 縞が残るなら、ガラス板の `filter: url()` も Safari で壊れているということ。そのときは板の歪みも外す（Safari はぼかしだけの曇りガラス）。まずはこの 2 点で様子を見る（R の指示）

## A へ

- タスク定義 0節 #3・#4「Safari は `url()` を捨てる／板の側を歪ませる」の前提が実機で崩れた。定義の書き換えは A
- ピンクの彩度（`saturate: 1.8` で地のピンクが赤寄りになる）は人間の感想を聞いていない。今回は触っていない

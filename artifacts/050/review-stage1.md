# 050（PR #349）— R の判定

futary-R で 35713bc を checkout して実行した。app 533・ui 16 緑。`tsc --noEmit` 緑・`eslint .` 緑。差分は `packages/ui`（Card の `padding`・Button の `compact`）・`post-card.tsx`・`post-images.tsx`・`timeline.tsx`・`releases.ts`・テスト・証跡。サーバ・契約・DB に差分無し。`worklog.md` は追記のみ。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 壊して確かめたこと（`post-card` / `post-images` / `memory-card` のテスト 35 本）

| 壊し方 | 赤 |
|---|---|
| 縦長 1 枚の上限を外す（常に幅いっぱい） | 2 本（T3） |
| 縦長を中央に置く（左寄せをやめる） | 2 本（T3） |
| 名前と時刻を 2 行に戻す | 1 本（T1） |
| ハートを `compact` にしない | 1 本（T2） |

## 読んで確かめたこと

- 0節 #1（T5）: `capture.json` で文字 1 行がピンク 94 / ホワイト 96、間 8・8・8。合計 102 / 104 で目標 104 以下。ハートの当たり判定 44（padding 12/12・margin -8/-8）
- 0節 #2: `Card` のまま。`padding` は prop で既定 lg のまま（他のカードは変わらない）
- 0節 #3・#4: 「名前 · 時刻」は 1 つの `Text`（名前は bold・時刻は muted）。本文はその直下で gap 無し
- 0節 #5: **B は `Button` を残して `compact` にした。定義は「`Button` をやめて `hitSlop`」だが、`conventions.md` 4節「副作用のある操作に生の `Pressable` を使わない。`Button` を通す」が上位で、B の判断が正しい。**「react-native-web の `Pressable` は `hitSlop` を DOM に反映しない」は私も確かめた（`dist/exports` で `hitSlop` を扱うのは `Touchable` だけ）
- 0節 #6: 間は `ItemSeparatorComponent` の sm だけ（`gap` との二重を解消）。左右の lg はそのまま
- 0節 #7: `singleImageLayout` は幅を測る前は full。自然な高さ > 360 のときだけ `{ width: 360 × 比率, height: 360, alignSelf: "flex-start" }`。実測 240×360・左 12（= カードの余白）
- 0節 #8: 2〜4 枚の分岐は触っていない（`post-images-row` はそのまま。033・041 の既存テスト緑）
- 0節 #10: `memory-card.tsx` は `PostImages` を使うので 360 の上限だけ掛かる。カードの余白・名前の行は思い出カード独自で触っていない（B の報告どおり）
- 0節 #12: 2.3.0 の文言・route は定義どおり
- スクリーンショット: `pink-timeline-full.png`（4 枚 / 横長 / 文字 1 行）・`pink-one-line-vs-x.png`（100pt の物差しより短い）を見た

## 記録（判定に使わない。1・2 は A へ）

1. **リリース履歴の版がぶつかる。**048 の 4節は段階2（決済）を **2.3.0**「プレミアムプランを始めました」としている。050 が 2.3.0 を使ったので、段階2 は 2.4.0 になる。A が 048 の 4節を直す
2. **定義 0節 #5「`Button` をやめて `hitSlop`」は `conventions.md` 4節と衝突する。**B は規約を守った。定義を現在の形（`Button` の `compact`。当たり判定は上下の余白で 44、`marginVertical: -8`）に合わせる。A の判断
3. **名前が長いと時刻が切れる。**「名前 · 時刻」が 1 つの `Text` で `numberOfLines={1}` なので、末尾（時刻）から省略される。名前の上限は 20 文字（`MAX_NAME_LENGTH`）。sm（14px）の全角 20 文字 ≈ 280px に対し、名前の行に使える幅は 390pt で約 254（自分の投稿。`⋯` あり）〜 282（相手の投稿）なので、**全角 13〜15 文字以上の名前で時刻が見えなくなる**（計算。実測はしていない）。050 の前は時刻が別の行だったので常に見えていた。直すなら名前と時刻を `row` に分けて、名前に `flexShrink: 1` + `numberOfLines={1}`、時刻に `flexShrink: 0`。ふたりの表示名でそこまで長いのは稀なので必須にしない。A の判断
4. ハートの `marginVertical: -8` は上側で本文の最終行の下 8px に重なる（本文の下端を押すとハート）。X も同じ形。実害は小さい。任意
5. 縦長 1 枚は幅を測る前の 1 描画が幅いっぱいで、`onLayout` 後に 360 に縮む（Web で最初の 1 フレームだけ高さが跳ぶ形）。実機で目に付くなら知らせてほしい
6. B の見つけた「4 枚の横一列が読み込み直後に末尾までスクロールしている」は `pink-timeline-full.png` でも右端の 1 枚が見えている（main でも同じ。050 ではない）。A へ

## 私が確かめていないこと

- 人間の実機で「X くらい」と言えるか・縦長が左に寄って揃っているか
- 記録 3 の実測（計算だけ）

# 050 fix（PR #352）— R の判定

futary-R で 4e546ee を checkout して実行した。app 534 緑・`tsc --noEmit` 緑・`eslint .` 緑。差分は `post-card.tsx` の名前の行と T1、証跡。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 採点表（PR 本文の 4 点）

1. 観測した事象: 段階1の R の記録 3 と一致
2. 原因: 名前と時刻が同じ `Text` で、省略が末尾（時刻）から掛かる。読んで一致
3. 再発を防ぐ手段: 別の `Text` を `row` に並べ、名前側 `flexShrink: 1`・`minWidth: 0`・`numberOfLines={1}`、時刻側 `flexShrink: 0`。A が 0節 #3・T1 に足した形と一致。本物のバンドルで全角 30 文字を実測（名前 195 で省略・時刻 68 が右端に見える。`pink-long-name.png` を見た: 「あいうえおかきくけこさしす…」の右に「· 4時間前」と `⋯`）。文字 1 行のカードは 94 のまま（050 の目標を崩していない）
4. 影響範囲: 名前の行だけ。`memory-card.tsx` は触っていない

## 壊して確かめたこと（`post-card.test.tsx` 30 本）

| 壊し方 | 赤 |
|---|---|
| 名前側の `flexShrink` を 0 に | 1 本（T1 の 30 文字） |
| 時刻側の `flexShrink` を 1 に | 1 本 |
| `minWidth: 0` を外す | 1 本 |
| 名前の `numberOfLines` を外す | 1 本 |

4 つとも T1 の 30 文字が拾う。既存の T1（同じ row に両方の文字・本文はその直下）は緑のまま。

## 記録（判定に使わない）

- T1 の 30 文字は jsdom なので幅は測れず、style と class（`r-textOverflow-`・`r-whiteSpace-`）で見ている。幅の実測は `pink-long-name.png` と PR 本文の数字が補う。十分

## 私が確かめていないこと

- 人間の実機（段階1と同じ）

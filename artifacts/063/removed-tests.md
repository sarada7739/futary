# 063: 消したテスト

1 本ずつ「ファイル・名前・0節のどれか・代わりに守っているテスト」。

## 段階1（0節 #10 のデッドコードと一緒に消えたもの）

| ファイル | 名前 | 0節 | 代わりに守っているテスト |
|---|---|---|---|
| `apps/app/test/glass-tab-bar.test.tsx` | G6「theme.ts の filterId が全部 +html.tsx に定義されている」 | #10（検査の対象の `filterId`・`glassFilter()` を消した） | G5「この部品で SVG フィルタ（url()）を使わない」（`url(` が部品に無いので、+html.tsx の定義との食い違いは起こらない） |
| `packages/ui/test/theme.test.ts` | T5「filterId は外観ごとに別」 | #10（`filterId` を消した） | T5「キーが両モードで同一」（残りの glass のキーの一致） |

0節 #6（必ず残すテスト）に当たるものは無い。

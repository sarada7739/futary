# 063 段階2: apps/app・packages/ui/src・apps/landing のコメント

`docs/tasks/063-prune-comments-and-tests.md`。コメントだけの差分（0節 #1〜#3。基準は段階1 と同じ）。

## 前後の数

測り方（TS/TSX: 行頭の空白の後が `//`・`/*`・`*`・`{/*`）:

```
git grep -hE '^[[:space:]]*(//|/[*]|[*]|[{]/[*])' <ref> -- <dir> | wc -l
```

HTML は `awk '/<!--/,/-->/'`、CSS は `awk '/\/\*/,/\*\//'` で複数行のコメントの行まで数えた。

| 範囲 | コメント行 前（main） | 後 |
|---|---|---|
| `apps/app/app` | 655 | **402** |
| `apps/app/components` | 514 | **279** |
| `apps/app/lib` | 342 | **213** |
| `packages/ui/src` | 321 | **160** |
| `apps/landing/*.html` | 29 | **25** |
| `apps/landing/style.css` | 43 | **38** |
| 計 | 1,904 | **1,117**（−787。約 41%） |

LP は節の見出し（`<!-- 1 ヒーロー -->` 等）と、スマホの枠の寸法の導出（CSS）を残したので減りが小さい。

## T1: テストの本数と結果が変わらない

`pnpm -r test`（全部緑。段階1 のマージ後と同じ）: ui 23・date 67・db 32・app 631・api 786 = **1,539**。
型検査（`pnpm -r run type-check`）・eslint 緑。

## T2: 差分がコメントだけ

- TS/TSX: `node artifacts/063/scripts/compare-code.mjs main apps/app packages/ui` → **93 ファイル全部「コメント以外が同じ」・コードが違う 0**
- HTML/CSS: `node artifacts/063/scripts/compare-landing.mjs main`（本番のビルドと同じ `stripHtmlComments`・`stripCssComments` で除き、空白を詰めて比べる）→ **6 ファイル全部同じ**

## 途中で気づいて直したこと（判断は R）

1. `apps/app/test/viewer-key-coverage.test.ts` は、`viewer-key-coverage-ignore` で免除した 2 箇所を**行番号**（`timeline.tsx:55:33`・`76:59`）で固定している。`timeline.tsx` の上の方のコメントを縮めると行がずれて赤くなったので、76 行目より前は**行数を元のまま**にして書いた（3 つのコメントを元と同じ 2・3・2 行で）。免除の注記（`// viewer-key-coverage-ignore -- 理由`）そのものは触っていない。段階3（テスト）で、行番号でなく中身で固定する形に変えるかは A・R の判断
2. `+html.tsx` で隣り合う 2 つの JSX コメント `{/* */}` を 1 つにまとめたら、空の JSX 式が 1 つ減ったのを T2 の道具が拾った（実行時の違いは無い）。2 つのままに戻した
3. `packages/ui/src/weather-codes.ts` は `artifacts/058/scripts/make-tables.mjs` が見出しのコメントごと生成する（「手で直さず作り直す」）。手で直すと生成物と食い違うので触っていない（一度直して戻した）

## 触らなかったもの

- `// viewer-key-coverage-ignore -- …`・`// eslint-disable-next-line …` のような、道具が読む注記
- 生成物（`weather-codes.ts`）
- `avatar-logic.ts` の 1 行（理由だけ）

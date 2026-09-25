# 065: LP の AI まとめの帯、スマホで文字を上下の真ん中に

## 目的

**人間の指示（2026-09-26。iPhone の Safari で見た）。** LP の「AIまとめ」の帯（節 5）で、スマホ幅だと文字が帯の上に寄り、下が空く。**真ん中にして見やすく。**

原因: `style.css` の 720px 以下で `.ai-band` が `flex-direction: column` になるが、文字の箱 `.ai-band-copy` は `flex: 1 1 auto` のままなので、縦の並びでは帯の高さ（`min-height: 200px`）いっぱいに伸びる。文字はその箱の上端に置かれる。

## 0. 決めたこと（A）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | 上下の位置 | **720px 以下で `.ai-band-copy { flex-grow: 0; }`**（文字の箱を中身の高さに戻す）と、`.ai-band` を **`justify-content: center`**（PC・スマホとも。子が 1 つなので PC の見た目は変わらない。縮んだ箱を縦の真ん中に置く）。`min-height: 200px`・`padding` はそのまま | 箱が伸びている限り、帯の側の揃えは効かない。PC は横並びで箱が横に伸びるのが要るので、`flex-grow` を止めるのは 720px 以下だけ |
| 2 | 説明の 1 行の折れ | `.ai-band-copy p` に **`text-wrap: balance`**（`h2` と同じ）。スマホで「…振り返りま / す。」と 1 文字だけ次の行に落ちるのを避ける | 見出しで既に使っている揃え方 |
| 3 | 文言・絵 | 変えない | 位置だけ |
| 4 | `releases.ts` | 載せない（LP の見た目で、アプリの機能ではない） | |

## 1. B の作業

- `apps/landing/style.css`: 0節 #1・#2（CSS 3 行）
- 画面: `artifacts/065/` に 375 幅（帯の文字が上下の真ん中・説明が 2 行に揃う）と 1280 幅（今までと同じ）を 1 枚ずつ

## 2. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | `style.css` の `.ai-band` に `justify-content: center`（`space-between` が無い）。720px 以下に `.ai-band-copy { flex-grow: 0; }`。`.ai-band-copy p` に `text-wrap: balance` | `apps/api/test/landing.test.ts` |

## 完了条件

- T1。`pnpm -r test`・型チェック・lint
- 画面 `artifacts/065/`（375・1280）
- 本番デプロイ後、人間が iPhone で見る
- `state.md` / `worklog.md`

## 停止条件

- レビュー往復 3 回 → A へ

## 順序

すぐ。小さい（CSS 3 行とテスト 1 つ）。

# 060: 本番の LP からコメントを落とす（ビルド時に HTML・CSS のコメントを除く）

## 目的

**人間の指示（2026-09-17）。** `https://nisoine.com/` の HTML に 21 個、`style.css` に約 980 個のコメントがそのまま出ている（`scripts/build-public.mjs` が `apps/landing/` を `cpSync` で写すだけのため）。中にはタスク番号・内部の文書のパス（`docs/tasks/054-…`・`artifacts/054/scripts/…`）・内向きの注記（「売り文句を足さない」「数字は例で動かない」）があり、開発者ツールから読める。

**ソースのコメントは残したまま、配信するファイルからだけ落とす。**秘密情報は含まれていない（確認済み）ので急がないが、体裁の問題。

## 0. 決めたこと（A）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | どこで落とすか | **`scripts/build-public.mjs` の複製の段。**`apps/landing/` の `*.html`（`index`・`privacy`・`terms`・`tokushoho`・`tech`）と `style.css` を、`cpSync` の代わりに読んで → コメントを除いて → 書く。`assets/`・`robots.txt`・`sitemap.xml` は今まで通り `cpSync` | 本番だけ変わる。ソースは今まで通りコメントで設計を残す（`conventions.md` の「コメントは日本語で理由を書く」は変えない） |
| 2 | HTML のコメント | `<!--[\s\S]*?-->` を空文字に。**条件付きコメント（`<!--[if …]>`）は使っていない**ので区別しない。除いた後に残る空行は**そのままでよい**（空白の圧縮はしない。差分を読めるように） | 1 つの正規表現で足りる。圧縮ツール（html-minifier 等）は入れない（依存を増やさない。054 の 0節 #13「JS 無し」と同じ考え） |
| 3 | CSS のコメント | `/\/\*[\s\S]*?\*\//g` を空文字に。**`content: "…"` の文字列の中に `/*` は無い**（`style.css` の `content` は `""`・`"✓"` の 3 箇所だけ。B が確かめてテストで固定する: T3）。`url()` にも無い | 文字列の中の `/*` を正しく扱う CSS パーサは入れない。無いことをテストで留める |
| 4 | 関数の置き場 | `build-public.mjs` に `stripHtmlComments(text)`・`stripCssComments(text)` を**export** し、末尾の `main()` を **`import.meta.url` が入口のときだけ**呼ぶ形に（`process.argv[1]` と比べる）。テストは `apps/api/test/` から `import` する | `scripts/` にテストの仕組みが無い。既存の `landing.test.ts` の隣に置く |
| 5 | `wrangler dev`・CI の `wrangler deploy` | 変えない（`predeploy` が同じスクリプト） | 経路は 1 つ |
| 6 | `apps/app` の Expo の出力 | 触らない（Metro が圧縮する） | 対象外 |
| 7 | CSP のインライン script のハッシュ | 影響なし（Worker が**配信する HTML から**計算する。LP に `<script` は無い。054 T2） | ハッシュはビルドの HTML を見ない |
| 8 | `landing.test.ts` の既存のテスト | **ソース `apps/landing/` を読むので変わらない**（`vitest.landing-assets.ts` の仮想モジュール）。060 のテストは**出力**を確かめる | ソースの検査と出力の検査を分ける |

## 1. B の作業

- `scripts/build-public.mjs`: `stripHtmlComments`・`stripCssComments` を足して export。`index.html`・`privacy.html`・`terms.html`・`tokushoho.html`・`tech.html`・`style.css` の複製をこれを通す形に。`main()` の呼び出しを入口の判定で包む（0節 #4）。先頭のコメント（出力構成）に 1 行足す
- `apps/api/test/build-public.test.ts`（新規）: T1〜T4
- `docs/architecture.md`・`conventions.md` は触らない（起票不要。ビルドの中身は `build-public.mjs` の先頭が正）

## 2. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | `stripHtmlComments`: `<!-- a -->` が消える・複数行のコメントが消える・`-->` を越えて次のコメントまで食わない（`<!-- a --> x <!-- b -->` → ` x `）・コメントの無い文字列はそのまま | `apps/api/test/build-public.test.ts` |
| T2 | `stripCssComments`: `/* a */` が消える・複数行が消える・`*/` を越えて食わない・`content: "✓"` のような文字列はそのまま | 同上 |
| T3 | 実物の `apps/landing/style.css` に、`content:` の値と `url(` の中に `/*` が無い（0節 #3 の前提。仮想モジュールの `landingStyleCss` から `content:` の行を集めて確かめる） | 同上 |
| T4 | 実物の `apps/landing/index.html`・`tech.html`・`style.css` を通した結果に `<!--`・`/*` が **0 個**、かつ `<iframe`・`<section class="demo"`・`.demo-inner`・`padding: 22px;` は残る（054・056・059 の固定値が消えていない） | 同上 |

## 完了条件

- T1〜T4。`pnpm -r test`・型チェック・lint
- `pnpm build:public` を通し、`apps/api/public/index.html` と `style.css` に `<!--`・`/*` が無いこと（`grep -c` の結果）を `artifacts/060/stage1.md` に。`wrangler dev` で `/` と `/privacy` と `/tech` が今まで通り表示される（画面 1 枚ずつ）
- 本番デプロイ後、人間が `https://nisoine.com/` の開発者ツールでコメントが無いのを見る
- `state.md` / `worklog.md`

## 停止条件

- `style.css` の `content:` か `url(` に `/*` が見つかる → 正規表現では落とせないので A へ（その箇所を書き換える方が早い）
- `main()` を入口の判定で包んだあと `pnpm build:public`・`predeploy` で動かない（Windows の `process.argv[1]` のパス形式）→ `fileURLToPath` で揃える。それでも駄目なら A へ
- レビュー往復 3 回 → A へ

## 順序

059 の後、すぐ。小さい（スクリプト 1 つとテスト 1 つ。アプリ・API は触らない）。iOS 段階0・メール認証の前。

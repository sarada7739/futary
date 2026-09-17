# 060 段階1: 本番の LP からコメントを落とす（ビルド時に HTML・CSS のコメントを除く）

`docs/tasks/060-strip-comments-on-build.md`。スクリプト 1 つ・テスト 1 つ・型宣言 1 つ。アプリ・API のコードは触っていない。

## 変更

- `scripts/build-public.mjs`
  - `stripHtmlComments(text)`（`<!--[\s\S]*?-->` → 空）・`stripCssComments(text)`（`/\/\*[\s\S]*?\*\//g` → 空）を export
  - 複製の段: `index`・`privacy`・`terms`・`tokushoho`・`tech` の HTML と `style.css` は「読む → 除く → 書く」（`copyStripped`）。`robots.txt`・`sitemap.xml`・`assets/` は今まで通り `cpSync`
  - 末尾の `main()` を `isEntry`（`path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`）で包んだ。`node scripts/build-public.mjs`（root）・`node ../../scripts/build-public.mjs`（`predeploy`）はどちらも相対パスで、`path.resolve` で揃う（root の形で実際に走らせた）
  - 先頭のコメント（出力構成）に 060 の 1 行
- `scripts/build-public.d.mts`（新規）: 上の 2 関数の型。`.mjs` の隣に同名の `.d.mts` を置くと `tsc` が拾う（`apps/api/test/raw-import.d.ts` に `declare module "../../../scripts/…"` と書く形は相対パスの ambient 宣言が効かず TS7016 のままだった）
- `apps/api/test/build-public.test.ts`（新規）: T1〜T4。workerd（`nodejs_compat`）でも `build-public.mjs` を import できた（`node:child_process` 等は stub。`main()` は走らない）

## テスト

| # | 何を | 結果 |
|---|---|---|
| T1 | `stripHtmlComments`: 1 つ・複数行・`-->` を越えない（`<!-- a --> x <!-- b -->` → ` x `）・無ければそのまま | 緑（4 件） |
| T2 | `stripCssComments`: 1 つ・複数行・`*/` を越えない・`content: "✓"` 等の文字列はそのまま | 緑（4 件） |
| T3 | 実物の `style.css` の `content:` の値は `""`・`"✓"`・`"+"`・`"−"` だけ（`/*` 無し）。`url(` の中にも無し | 緑（2 件） |
| T4 | 実物の `index.html`・`tech.html`・`style.css` を通すと `<!--`・`/*`・`*/` が 0 個。`<iframe`・`<section class="demo"`・`.demo-inner`・`padding: 22px;`・「技術構成」は残る。出力に `docs/tasks/`・`artifacts/` が無い | 緑（3 件） |

`apps/api` vitest 32 ファイル 786 件 緑・`tsc --noEmit`（api・root）緑・eslint 緑。

## `pnpm build:public` の結果（`build.log`。exit 0。インライン script 2 本の検査もそのまま通った）

| ファイル | ソースのコメント | 出力のコメント | 大きさ（バイト） |
|---|---|---|---|
| `index.html` | `<!--` 21 | **0** | 17,719 → 15,801 |
| `tech.html` | `<!--` 1 | **0** | |
| `privacy.html`・`terms.html`・`tokushoho.html` | 0 | 0 | |
| `style.css` | `/*` 30（`grep -o` の数。行数ではない） | **0**（`*/` も 0） | 17,492 → 13,905 |

`docs/tasks`・`artifacts/` の文字列は出力の `index.html`・`style.css` に 0。`robots.txt` はソースと同一。`assets/` 23 ファイル。

## 画面（`artifacts/060/`。wrangler dev = ビルドの出力。`scripts/capture.mjs`）

| ファイル | 内容 |
|---|---|
| `pc-index.png` | `/`。1280 幅の最初の画面。見た目は 059 のまま |
| `pc-privacy.png` | `/privacy`。全体 |
| `pc-tech.png` | `/tech`。全体 |

`capture.json`: 配信される `/`・`/privacy`・`/terms`・`/tokushoho`・`/tech`・`/style.css` の `<!--`・`/*` が全部 0（`served`）。3 ページとも `.container` の `max-width` 960px・本文の色が効いている（CSS が壊れていない）。`consoleErrors` 0。

## 気づき（判断は A・人間）

- タスク定義の目的にある「`style.css` に約 980 個」は、ソースの `/*` の数では 30（`grep -o "/\*" | wc -l`）。コメントの行数や `*` の数を数えた値と思われる。判定には関係ない

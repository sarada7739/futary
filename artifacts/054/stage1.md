# 054: ランディングページを一般向けに作り直す — 実装の報告

2026-09-16 / セッションB。タスク定義 `docs/tasks/054-landing-for-users.md`（main 612f27d）。

## 変えたもの

| 場所 | 何を |
|---|---|
| `apps/landing/index.html` | 1 節の構成（H・1〜12・F）で書き直し。文言は 3 節のとおり（売り文句は足していない）。「はじめる」→ `/app/` は 4 箇所（ヘッダー・ヒーロー・プレミアム・最後）。`<script>` 無し・`style` 属性無し。FAQ は `<details>`。`<img>` 全部に `width`/`height`。ヒーローとヘッダーのロゴ以外は `loading="lazy"`。「気分の記録」の折れ線は小さな inline SVG（`stroke="currentColor"`。色は CSS） |
| `apps/landing/tech.html`（新規） | 054 前の `index.html` の `<section class="tech">` を文言を変えずに移した。`<title>Nisoine の技術構成</title>`・`description`・`canonical` は 2 節のとおり。上にロゴ（`/` へ）、下にフッター。`sitemap.xml` には載せていない |
| `apps/landing/style.css` | 書き直し。トークンは `theme.ts` の値（`--color-primary-subtle` #FCE4E4・`--shadow-card` を追加）。見出しは明朝のシステムフォント（0節 #6。Web フォント無し）。本文の幅 960。AI まとめの帯だけ濃紺（`--color-ai-band` #0B1038。写真の地の実測 #070E3A 前後）。**法務ページが使うクラス（`.hero .logo .tagline .tech-intro .decisions .decision .table-wrap .footer`）は値を変えていない**。スマホ（720px 以下）は 1 列 |
| `apps/landing/assets/` | 写真 11 枚（`artifacts/054/scripts/make-assets.py`。品質 82・表示幅の 2 倍まで。**最大 107KB・合計 522KB**）+ 線画 8 枚（`packages/ui/assets/` の複製）。015 の `feature-*.png` 4 枚は消した |
| `scripts/build-public.mjs` | `tech.html` を `public/` へ写す 1 行 |
| `apps/api/vitest.config.ts` | T4 用の仮想モジュール `virtual:landing-assets`（テストは workerd で `node:fs` が無いので、Vite 側で `apps/landing/assets/` の名前と大きさを読んで渡す） |
| `apps/api/test/landing.test.ts`（新規） | T1〜T5 + 文言の検査（下） |
| `docs/sample/README.md` | 「054 で切り出したもの」の節 |

## テスト

| # | 何を | 結果 |
|---|---|---|
| T1 | `GET /` `GET /tech` が 200。`/` に `tech-heading`・`decisions`・GitHub のリンクが無く、`/tech` に 4 つの見出しと 2 つのリンクがある。`sitemap.xml` に `/tech` は無い | 緑 |
| T2 | `/` `/tech` に `<script` が無い。`style=` も無い | 緑 |
| T3 | `/` の `<img>`（25 個）全部に `width`/`height`。lazy でないのはヒーローとヘッダーのロゴの 2 つだけ | 緑 |
| T4 | JPEG 11 枚が役割の名前で揃い、1 枚 250KB 以下・合計 1.5MB 以下。`index.html` が参照する `/assets/` は全部ある | 緑 |
| T5 | `/privacy` `/terms` `/tokushoho` が 200 で `style.css` を読み、`.hero` `.decisions` を使っている。見た目は `privacy-mobile-375.png`・`tokushoho-mobile-375.png` | 緑 |
| T6 | `/` の応答ヘッダ（CSP 等）は 053 T4b の既存テストがそのまま緑 | 緑 |
| 文言 | 「はじめる」4 箇所・デモとプレミアムのリンク・Google Play の 1 行・¥420/¥4,200・50 万枚/30 枚・「5 万枚」無し・絵にあって無いもの（質問・みんなの声・30GB・通報・レビュー・デッキ・ブラインド）が無い・description | 緑 |

`pnpm lint`・`pnpm type-check`・`pnpm test`（api 711・app 551・db 32・date 67・ui 16）すべて緑。

## 画面（`wrangler dev` に `apps/landing` を複製して Playwright で撮影。`artifacts/054/scripts/capture.mjs`）

| ファイル | 何 |
|---|---|
| `pc-1280.png` | `/` 全画面（1280 幅） |
| `mobile-375.png` | `/` 全画面（375 幅） |
| `tech-pc-1280.png` `tech-mobile-375.png` | `/tech` |
| `privacy-mobile-375.png` `tokushoho-mobile-375.png` | 法務ページ（T5） |

`capture.mjs` の計測: **`/` `/tech` は 1280・375 とも `scrollWidth === clientWidth` で、画面幅より右へはみ出す要素は 0**。
`/privacy` `/tokushoho` の 375 で `table` がはみ出すのは 052 の設計（`.table-wrap` の横スクロール。ページ自体は `scrollWidth 375`）。

## B が決めたこと

- 写真の高さ: スマホのヒーローは 1552×656 の比のままだと 158px で小さいので、高さ 280px で中央を切る（`object-fit: cover`）
- `h2` に `text-wrap: balance`（375px で「ほしか / った。」のような折れを避ける。対応しないブラウザでは無視されるだけ）
- 統計カードのアバターは `woman1.jpg`・`man1.jpg` を上寄りの正方形で切り出し（顔が中央上寄りのため）
- 線画は `packages/ui/assets/` から複製した（LP は `packages/ui` を読めない。名前はそのまま）
- 帯の濃紺は写真の暗い側の実測（#070E3A）と定義の「#1B1F3B 前後」の間の #0B1038。写真の上に置くので、見えるのは写真の縁だけ

## A へ（3 節の文言と機能の食い違い。直していない）

- 7 節「思い出」の「使い始めた翌日から、**過去の 1 枚**が届きます」: `memory.*` は投稿を 1 件出す（画像のある投稿を優先するが、無ければ文だけの投稿も出る。`apps/api/src/procedures/memory.ts` `findOnDate`）。「1 枚」は写真だけに読める。文言はそのまま入れた

## 停止条件の確認

- 写真は品質 82 で全部 250KB に収まった（最大 107KB）。350KB への緩めは使っていない
- レビュー往復: 0

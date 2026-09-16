# 059 段階1: LP の「さわってみる」を 2 列に・帯の写真を外す・写真カードの余白・文言

`docs/tasks/059-landing-demo-two-columns.md`。LP の HTML と CSS と写真 1 枚だけ。アプリ・API のコードは触っていない（リリース履歴にも足さない。人間の指示）。

## 変更

- `apps/landing/index.html`
  - 節「demo」: `.container` の中に `.demo-inner`（左 `.phone`・右 `.demo-copy`）。右は上から `h2` さわってみる（左寄せ）→ `.demo-lead`「デモ画面です。投稿は見るだけで、書き込みはできません。」→ `<h3>枠の中を、そのまま触れます</h3>` → `<ul class="demo-guide">` 3 行（0節 #5 の文言のまま。`<strong>` はタブの名前）→ `<a class="btn btn-primary" href="/app/">自分たちで始める</a>`。iframe・枠の絵は 056 のまま
  - 節 5: `<img class="ai-band-photo">` を消した
- `apps/landing/style.css`
  - `.demo-inner`（`grid-template-columns: 527px 1fr; gap: 40px; align-items: center`）・`.demo-copy`（`h2` 左寄せ）・`.demo-lead`（中央寄せと負のマージンを外す）・`.demo-guide`（記号無し・8px 間隔）
  - `.demo-more` と `.ai-band-photo`（PC・720px 未満）を消した。`.phone` の `margin: 0 auto` を外した（grid の左の列に置くので要らない）
  - `.photo-card` の `padding` を四方 22px、`.photo-card img` の `border-radius` を四隅 14px に（`.cards-2` も同じクラスなので一緒に変わる。0節 #10）
  - `@media (max-width: 767px) { .demo { display: none } }` はそのまま
- `apps/landing/assets/hands-cafe.jpg` を消した（`docs/sample/landing/hands-cafe.jpg` は残る）
- `apps/api/test/landing.test.ts`: 054 T4 の一覧を 10 枚に。056 T5 の固定値（文言・リンク）を 059 の形に。059 T1〜T5 を追加

## テスト

| # | 何を | 結果 |
|---|---|---|
| T1 | `/` に `hands-cafe` 無し・`assets/` に無し・JPEG 10 枚 | 緑 |
| T2 | 節 demo の中に iframe・「デモ画面です。…」（「ゆいとれん」無し）・`<h3>`・`.demo-guide` の `<li>` 3 つが 0節 #5 の文言どおり・ボタン・`<script` 無し | 緑 |
| T3 | `.demo-inner` の `grid-template-columns: 527px 1fr`・`.ai-band-photo` と `.demo-more` が無い・767px の `display: none` そのまま | 緑 |
| T4 | 見出しの階層: `h1` 1 つ・最初の `h3` は最初の `h2` の後・demo の `h3` は `demo-heading` の後。054 T3（`<img>` の width/height）も緑のまま | 緑 |
| T5 | `.photo-card { padding: 22px }`・`.photo-card img { border-radius: 14px }`・`14px 14px 0 0` 無し | 緑 |

`apps/api` vitest 31 ファイル 773 件 緑・`tsc --noEmit` 緑・eslint 緑。

タスク定義の T4 は「054 T3（見出しの階層）」と書いてあるが、054 の T3 は `<img>` の width/height で、見出しの階層のテストは 054 に無かった。059 T4 として新しく書いた（上の表）。

## 画面（`artifacts/059/`。`scripts/capture.mjs`。wrangler dev の `apps/api/public` に LP の 3 ファイルを写して撮った。`public/app` は前のビルドのまま）

| ファイル | 内容 |
|---|---|
| `pc-demo.png` | 1280 幅。スマホが左（527px）・右に見出し + 説明 + 案内 + ボタン。右の列の幅 345px、上下中央（上下の余白の差 0px） |
| `pc-ai-band.png` | 帯は地の絵と中央の文字だけ。写真無し。高さ 200px |
| `pc-cards-3.png` / `pc-cards-2.png` | 写真の下に余白（img の下端とカードの下端の差 23px = 22px + 枠線 1px。左右も 23px）。四隅 14px |
| `pc-full.png` | 1280 幅の全体 |
| `w800-demo.png` | 800 幅。右の列 185px。文字と案内が折り返して収まる（横スクロール無し: scrollWidth 800 = clientWidth）。**ボタンの文字も 2 行に折れる**（0節 #7「そのままでよい」の範囲だが記録） |
| `mobile-375-ai-band.png` / `mobile-375-cards-3.png` | 375 幅。節 demo は `display: none`。帯に写真無し。カードの余白は同じ |

`capture.json`: 計測値。`consoleErrors` は 0。

## 気づき（判断は A・人間）

- 800 幅でボタン「自分たちで始める」が 2 行に折れる（`.btn-primary` の `padding: 14px 44px` が右の列 185px に収まらない）。0節 #7 のとおり分岐は作っていない。気になるなら `.demo-copy .btn-primary { white-space: nowrap; padding-inline: 32px }` で 1 行にできるが、B は変えていない

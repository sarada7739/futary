# 054（PR #387）— R の判定

futary-R で 7cf10c9 を checkout して実行した。api 711（`landing.test.ts` + `canonical-host.test.ts` 45）緑。`tsc --noEmit` 緑・`eslint .` 緑。`worklog.md` は追記のみ。`sitemap.xml`・`robots.txt` は差分無し。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 自分で確かめたこと

- **3 節の文言**: タスク定義 3 節のバッククォートの文字列（見出し・本文・ピル・FAQ・価格・注・フッター）を全部 `index.html` の本文と突き合わせて、**欠けているものは無い**（`description`・`og:description` は属性側で別に確認）。3 節に無い売り文句は読んで見つからなかった。「6 桁の招待コード」は契約の `length(6)` と一致
- `/app/` へのリンクは 5 つ（「はじめる」4 + デモ 1）。`/app/premium`・`#features`・`#premium`・法務 3 つ・`/tech`
- `<script`・`style=` は `index.html`・`tech.html` とも 0
- `tech.html` の `<section class="tech">` は 054 前の `index.html` の同じ節と本文が同じ（タグと注釈を剥がして比較）。`<title>`・`description`・`canonical` は 2 節どおり
- 写真: JPEG 11 枚。最大 106KB（`hero-beach` 1552×656）・合計 522KB。`avatar-*` 240（表示 120 の 2 倍）・カード 640×482・正方形 800（0節 #8 の範囲）
- 絵: `pc-1280.png` 全体と `mobile-375.png` の上部を見た。構成は 1 節の H・1〜12・F の順。AI の帯だけ濃紺。375 で 1 列

## 壊して確かめたこと

| 壊し方 | 赤 |
|---|---|
| inline script を足す | 2 本（T2 + 053 T4b の CSP 固定比較） |
| `<img>` の `width` を 1 つ消す | 1 本（T3） |
| `/` に技術構成の節を戻す | 1 本（T1） |
| 「はじめる」を 3 箇所にする | 1 本（文言の検査） |

## 記録（判定に使わない）

1. 375px で見出し「ふたりのこと、置き場がほしかった。」が「置き / 場」で折れる（`text-wrap: balance` でも語の途中）。気になるなら `<br />` を「、」の後に入れる（文言は変わらない）。任意
2. B の A への申し送り（「過去の 1 枚」と `memory.*` の挙動）は妥当。3 節は A のもの

## 私が確かめていないこと

- 本番デプロイ後の `https://nisoine.com/`・`/tech`（人間の手番）
- `tech-*.png`・法務ページの 2 枚（T5 は緑を見た）

## 追補 PR #389（e07e243）— R の判定

futary-R で e07e243 を checkout。`billing.test.ts` 38 + `landing.test.ts` 17 = 55 緑。`eslint .` 緑。`worklog.md` は追記のみ。

**受け入れ。必須修正なし。**

- `index.html`: 「過去の 1 枚が届きます。」→「過去の投稿がそっと届きます。」の 1 行だけ。A が #388 で 3 節に書いた文言と一致。旧文言は残っていない（grep 0）
- `billing.test.ts`: `Date.now()` を 1 度だけ取って `putSubscription`・`nowSeconds`・`expect` で同じ値。秒の境目の flake の直し方として正しい（`couple.get` の中の `resolvePlan` は実時刻で判定するが、期限は `now + 86400` なので影響しない）

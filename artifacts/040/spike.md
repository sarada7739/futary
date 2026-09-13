# 040 段階0: Amazon 等の商品ページを Cloudflare から fetch して画像が取れるか

2026-09-13 / セッションB。**A の決定待ちで止まる**（タスク定義 2節）。

## 測り方

- `artifacts/040/spike/` の使い捨て Worker を `wrangler dev --remote`（Cloudflare 側で実行）で動かし、手元から叩いた
  - `index.mjs`: 指定 URL を GET → 先頭 512KB を読んで `og:title` / `og:image` を正規表現で拾う → 画像を GET して型と大きさを見る
  - 5 秒で打ち切り。Cookie・認証ヘッダ無し。`redirect: "follow"`
  - 予備の抽出（OGP が無かった場合の切り分け用）: `<meta name="title">`・`data-old-hires`・`twitter:image`
  - 切り分け用の引数 `timeoutMs` / `headLimit` / `charset` は既定では本番の要件どおり（5 秒 / 512KB / UTF-8）
- `run.sh`: URL × UA 2 通り × 3 回。生の結果は `results-*.jsonl` / `results-*.txt`
- UA (1): `futary-link-preview/1 (+https://futary-api.sarada7739.workers.dev)`
- UA (2): `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36`
- Amazon 5 本: 人間の `B0HJBHHXK2`（iPhone 18 Pro Max）、同ページの関連 `B0HJB4LCRD` `B0HJ9Y9FN4`、売れ筋の `B0012VQKBE` `B07T35N29H`
- 楽天 `item.rakuten.co.jp/afternoon-tea-living/jp8670/`、ユニクロ `products/E422992-000/00`、無印 `cmdty/detail/4550723613880`

## 結果

| 店 | 回数 | HTTP 200 | **OGP で画像** | 予備の抽出で画像 | 所要 | 備考 |
|---|---|---|---|---|---|---|
| **Amazon** | 30（5 本 × 2 UA × 3） | **30/30** | **0/30** | **28/30**（512KB）/ **15/15**（1MB。UA (1) のみ） | 0.55〜1.7 秒（512KB）、1.4〜2.1 秒（1MB） | **OGP の meta が無い**。題名は `<meta name="title">`、画像は `#landingImage` の `data-old-hires` |
| 楽天 | 6 | **0/6**（5 秒で AbortError） | —（25 秒なら 3/3） | — | **約 10.1 秒**（10104〜10167ms） | 25 秒待てば 200・`og:image` あり（jpeg 28KB）。**EUC-JP** |
| ユニクロ | 6 | 6/6 | **6/6** | — | 0.18〜0.23 秒 | `og:image` jpeg 358KB（3:4） |
| 無印 | 6 | 0/6（**520**） | 0/6 | — | 0.02〜0.1 秒 | 本文 `error code: 520`（無印は Cloudflare 配下。Worker からの fetch を拒む）。手元の curl も本文無し。Chromium では表示できる |

**UA の差は無かった。**Amazon の 512KB での 2 回の失敗（UA (2)・`B07T35N29H`）は、UA ではなく画像ブロックの位置のばらつきによる（下記）。

### Amazon の中身

- **`og:title` / `og:image` / `twitter:image` を一切出さない。**`<head>`（約 60KB）に商品画像の URL も無い
- 題名: `<meta name="title" content="Amazon | Apple iPhone 18 Pro Max (2 TB) - グレイシャー | ProMotionを採用した… | スマートフォン本体 通販">`。
  **156 文字**（`title` の上限 100 を超える。「Amazon | 」の前置きと「 | カテゴリ 通販」の後置きが付く）
- 画像: `<img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/….jpg" data-a-dynamic-image="{…}">`。
  `data-old-hires` は 1500px、`data-a-dynamic-image` の先頭は 342px。**どちらも同じブロックにある**
- 画像ブロックの位置（`data-old-hires` のバイト位置）: ページ全体 1.1〜3.5MB のうち
  `B0HJBHHXK2` 325KB / `B0012VQKBE` 478KB / `B07T35N29H` 527・612・612KB（UA (2)）・438・440・440KB（UA (1)）。
  **同じ ASIN でも応答ごとに 100KB 以上ずれる。**512KB では取りこぼす応答がある。1MB では 15/15
- 画像本体: `image/jpeg` 55〜196KB（先頭 `ff d8 ff e0`）。上限 1MB に収まる
- 文字コードは UTF-8。`rel="canonical"` は `https://www.amazon.co.jp/Apple-iPhone-18-Pro-Max/dp/B0HJBHHXK2`（`/dp/{ASIN}` の正規化と噛み合う）

### 楽天の中身

- Cloudflare からの fetch は**必ず約 10 秒待たされてから 200**（3 回とも 10.1 秒。ranking トップ・www トップも 5 秒で切れた）。
  手元の PC の curl は ranking トップで「アクセスが集中しております」のページを即返した。**IP や UA で扱いを変えている**
- `Content-Type: text/html;charset=EUC-JP`。UTF-8 で読むと題名が化ける。
  **Workers の `TextDecoder("EUC-JP")` で正しく復号できた**（`【楽天市場】掛け分けマグカップペアセット Afternoon Tea LIVING …`）
- `og:image` は `shop.r10s.jp` の jpeg 28KB。ページは 118KB で 512KB に収まる

## タスク定義 2節の表に当てはめると

| 読み方 | Amazon の割合 | 表の行 |
|---|---|---|
| **OGP だけ**（タスク定義・security-requirements 6節の文字どおり） | **0 割** | 「どちらも 5 割未満 → 自動を入れない。手で付けるだけ」 |
| **Amazon 専用の予備（`meta name="title"` + `data-old-hires`）を入れる** | 512KB: **9.3 割** / 1MB: **10 割** | 「(1) で 8 割以上 → (1) で行く」 |

**B は測って止まる。**以下は A が決めること。

## A に決めてもらう論点

1. **Amazon 専用の抽出を入れるか。**OGP だけでは Amazon は 0 割。`<meta name="title">` と `data-old-hires="…"` を正規表現で 1 つずつ拾うだけだが、
   security-requirements 6節「取った HTML を解釈するのは OGP の `<meta>` だけ」の**条文の範囲を広げる**ことになる（DOM は組まない・script は評価しない、は変わらない）
2. **読み取り上限。**512KB のままなら Amazon は 28/30（応答の位置次第で落ちる）。**1MB なら 15/15**、所要は +0.5 秒ほど。
   `security-requirements.md` 6節の「先頭 512KB」を変えるかどうか
3. **楽天の 10 秒。**5 秒のままなら楽天は常に画像無し（手で付ける経路に落ちる）。B は停止条件「制限を緩めない」に従い 5 秒のまま
4. **文字コード。**楽天は EUC-JP。`Content-Type` の `charset` で `TextDecoder` を選ぶ（未知なら UTF-8）。仕様に一文要る
5. **題名の切り詰め。**Amazon の題名は 156 文字（上限 100）。前置き「Amazon | 」と後置き「 | … 通販」を落とすか、100 文字で切るか
6. 無印（520）は「失敗して画像無し」の想定どおり。**何もしない**でよいか

## 段階1（T2）のフィクスチャに使えるもの（`spike/html/`）

| ファイル | 用途 |
|---|---|
| `amazon-B0HJBHHXK2-ua-futary.html` | 512KB の中に `data-old-hires` がある応答（OGP 無し） |
| `amazon-B07T35N29H-ua-browser-2.html` | 512KB の**外**に画像ブロックがある応答（512KB で切ると画像無し） |
| `rakuten-jp8670-ua-futary.html` | EUC-JP・OGP あり（118KB。全体） |
| `uniqlo-E422992-ua-futary.html` | UTF-8・OGP あり（`og:image` と `twitter:image` が同じ） |
| `muji-4550723613880-ua-futary.html` | 520 の本文（16 バイト。HTML ではない） |

「壊れた HTML」は段階1で手で作る。

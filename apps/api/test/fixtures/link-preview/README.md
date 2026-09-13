# link-preview のフィクスチャ（040 T2）

段階0（`artifacts/040/spike.md`）で Cloudflare 側から実際に取った HTML。
第三者のトークン（Amazon の匿名セッション ID・CSRF、楽天・ユニクロのページ埋め込みキー）は `REDACTED` に置き換えてある。

| ファイル | 中身 |
|---|---|
| `amazon-B0HJBHHXK2.html` | Amazon（UTF-8）。先頭 512KB。OGP 無し。`<meta name="title">` と `data-old-hires` がこの中にある |
| `amazon-B07T35N29H-head512k.html` | Amazon の別の応答の先頭 512KB。画像ブロックが 512KB の**外**にあった応答（テストが実物の `<img id="landingImage">` を 512KB より後ろに継ぎ足し、1MB なら取れることを固定する） |
| `rakuten-jp8670.euc-jp.html.base64` | 楽天（**EUC-JP**）。全体 118KB。OGP あり。EUC-JP のバイト列を保つため base64 |
| `uniqlo-E422992.html` | ユニクロ（UTF-8）。先頭 512KB。OGP あり（`og:image` と `twitter:image` が同じ） |
| `muji-520.txt` | 無印の 520 応答の本文（HTML ではない） |

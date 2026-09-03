# 030: アプリアイコンと favicon を差し替える — テスト結果

## 画像の書き出し

すべて `docs/sample/icon/futary-icon-square-1024.png`（1024×1024・RGB。
角の白を背景で埋めた正方形版）から、Pillowの`LANCZOS`リサンプリングで
書き出した。**角丸の元画像（`futary-icon-source.png`）は使っていない**
（サイズ検証も入れて確認: 元画像を誤って渡すと1024×1024でないため
その場で失敗する形にした）。

| ファイル | サイズ | 置き場所 |
|---|---|---|
| `favicon.png` | 48×48 | `apps/landing/assets/`・`apps/app/assets/` |
| `apple-touch-icon.png` | 180×180 | `apps/landing/assets/`・`apps/app/public/` |
| `icon-192.png` | 192×192 | `apps/app/public/` |
| `icon-512.png` | 512×512 | `apps/app/public/` |
| `icon.png` | 1024×1024（縮小なし） | `apps/app/assets/`（ネイティブ用。Web出力には使わないが元と揃える） |

生成に使ったスクリプトはリポジトリには残していない（PythonのPillowは
このJS/TSモノレポの他のどこにも依存として無く、一度きりの変換作業のため）。
再現方法: `futary-icon-square-1024.png`をPillowで開き、
`Image.resize((size, size), Image.LANCZOS)`で各サイズへ縮小して保存。

## `apps/app/assets/` と `apps/app/public/` を使い分けた理由

タスク定義は「`apps/app/assets/`の両方に要る」としていたが、実装時に
Expoの静的Web書き出し（`expo export --platform web`）の実際の挙動を
確認したところ、次の違いがあった:

- `apps/app/assets/`配下の画像は、コード側で`require()`して初めて
  バンドラーがハッシュ付きファイル名で書き出す（`app.json`の
  `web.favicon`・`icon`のように、既存の設定項目が指す画像だけが対象）。
  **`require()`されない画像は書き出されない**
- `apps/app/public/`配下は、Expoの組み込み機能（`getPublicFolderPath`・
  `copyPublicFolderAsync`。`@expo/cli`のソースで確認）により、
  **中身がそのまま出力ディレクトリの直下へコピーされる**

`manifest.webmanifest`・`apple-touch-icon.png`・`icon-192.png`・
`icon-512.png`は、`+html.tsx`から固定パス（`/app/apple-touch-icon.png`等）
で参照する必要があるため、後者（`apps/app/public/`）でなければ
実現できない。既存のfavicon・ネイティブicon（`app.json`の
`web.favicon`/`icon`が指すもの）だけを`apps/app/assets/`に残した。
この使い分けはB独自の技術判断であり、タスク定義の「assets/」という
記述と実装が一致しない点はAへの報告事項とする。

## `apps/app/app/+html.tsx`（新設）

Expo Routerの既定HTMLテンプレートには`apple-touch-icon`・`manifest`への
`<link>`が無い。新設し、以下を追加した:

- `<link rel="apple-touch-icon" href="{baseUrl}/apple-touch-icon.png">`
- `<link rel="manifest" href="{baseUrl}/manifest.webmanifest">`
- `<meta name="apple-mobile-web-app-title" content="futary">`
- `<meta name="theme-color" content="#F5868D">`
- **`apple-mobile-web-app-capable`は意図的に入れていない**
  （タスク定義4節。standaloneにすると、ホーム画面から開いたときSafariの
  枠が消え、Googleログインの遷移が別の入れ物に飛んで戻ってこないことが
  あるため）

`baseUrl`は`process.env.EXPO_BASE_URL`から取る。ハードコードで`/app`と
書かず、`app.json`の`experiments.baseUrl`が変わってもここを書き直さずに
済む形にした。この環境変数がExpo Routerの静的書き出し時に実際に
`/app`へ解決されることを実測で確認済み（既定のfaviconリンクが
`/app/favicon.ico`になる仕組みと同じ）。

## `manifest.webmanifest`（新設・`apps/app/public/`）

```json
{
  "name": "futary",
  "short_name": "futary",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "display": "browser",
  "theme_color": "#F5868D",
  "background_color": "#FEF6F3"
}
```

タスク定義4節どおり`display`は`"browser"`（`standalone`にしない）。
アイコンのパスは相対パス（`manifest.webmanifest`自身のURLからの相対）で
書いており、`baseUrl`が変わってもここは書き直さなくてよい。

## `apps/landing/index.html`

`<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />`を
既存の`<link rel="icon">`の直後に1行追加した。

## 配信経路の確認（`scripts/build-public.mjs` → `wrangler dev` の実ビルド）

タスク定義5節の3点をすべて実測で確認した:

1. **`build-public.mjs`のコピー対象**: `apps/landing/`直下は
   `index.html`・`style.css`・`assets/`の3つだけがコピー対象（コードを
   確認）。`manifest.webmanifest`等は`apps/app/public/`側に置いたため、
   この経路には影響しない（landingは元々manifestを持たない設計のまま）
2. **CSPの`_headers`**: `node scripts/build-public.mjs`を実行して生成した
   `_headers`は`default-src 'self'`のみで`manifest-src`を明示していない。
   `wrangler dev`で実ビルドを配信し、`/app/`・`/`の両方をブラウザで開いて
   コンソールにCSP違反のエラーが1件も出ないこと、
   `document.querySelector('link[rel="manifest"]')`・
   `link[rel="apple-touch-icon"]`が正しいURLに解決されていることを
   実測で確認した（`manifest-src`は`default-src`にフォールバックする
   仕様どおり、同一オリジンのため追加設定は不要だった。「たぶん通る」で
   終わらせず実測した）
3. **`experiments.baseUrl`の実際の解決**: `/app/*`から参照する全パスは
   `/app/apple-touch-icon.png`・`/app/manifest.webmanifest`・
   `/app/icon-192.png`・`/app/icon-512.png`・`/app/favicon.ico`の形で
   生成され、`fetch()`で全て`200`（`Content-Type`も画像/JSON/icoで
   それぞれ正しい）であることを確認した。`apps/landing/`側の
   `/assets/apple-touch-icon.png`・`/assets/favicon.png`も`200`

## テスト・型チェック・lint

`pnpm test`（apps/app 213件・apps/api 399件・他パッケージ含め全て緑）・
`pnpm type-check`・`pnpm lint`全て通過（`+html.tsx`新設・画像差し替えのみで、
既存のロジックには触れていないため回帰は想定していなかったが、念のため
フルスイートを実行して確認した）。

## Bによるブラウザでの確認

`node scripts/build-public.mjs`で実ビルドを生成し、`wrangler dev`で
配信して確認:

- `/`（ランディング）: タブアイコン・`apple-touch-icon`のリンクが新しい
  画像を指し、`200`で取得できる。コンソールエラー無し
- `/app/`（アプリ本体）: `/app/sign-in`へ正しく遷移し、`manifest`・
  `apple-touch-icon`のリンクが`/app/...`へ正しく解決されている。
  コンソールエラー無し
- 生成した`favicon.ico`（Expoが`apps/app/assets/favicon.png`から
  自動生成したもの）をPillowで開いて内容を目視確認。新しいアイコンに
  なっている

**iPhoneでの「ホーム画面に追加」の実機確認はB（自動化）ではできない**
（タスク定義・確認観点）。`artifacts/030/manual-check.md`参照。

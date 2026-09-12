import { ScrollViewStyleReset } from "expo-router/html";

// 030: 既定のHTMLテンプレート（Expo Routerの組み込みテンプレート）には
// apple-touch-icon・manifest への <link> が無い。iOSはこれが無いとホーム画面に
// ページのスクリーンショットを置く（タスク定義2節）。既定のfaviconリンクだけは
// app.jsonのweb.faviconから自動生成されるため、ここでは追加しない。
//
// `/app/...`という絶対パスをそのまま書くとexperiments.baseUrlの環境で外れる
// （タスク定義5節）。process.env.EXPO_BASE_URLはExpo Routerの静的書き出し時に
// baseUrl（app.jsonのexperiments.baseUrl。この構成では"/app"）がそのまま入る
// ことを実測で確認済み（既定のfaviconリンクが/app/favicon.icoになるのと同じ
// 仕組み）。これを使えば baseUrl が変わっても書き直さずに済む
const baseUrl = process.env.EXPO_BASE_URL ?? "";

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        <link rel="apple-touch-icon" href={`${baseUrl}/apple-touch-icon.png`} />
        <link rel="manifest" href={`${baseUrl}/manifest.webmanifest`} />
        {/* ホーム画面に出る名前。開き方（display: browser）は変えない
            （タスク定義4節）。apple-mobile-web-app-capableは意図的に入れない
            （standaloneにすると、ホーム画面から開いたときSafariの枠が消え、
            Googleログインの遷移が戻ってこないことがあるため） */}
        <meta name="apple-mobile-web-app-title" content="futary" />
        {/* colors.primaryと同じ値のリテラル。@futary/uiから直接importしない
            （Rレビュー指摘）: packages/ui/src/index.tsはcomponentsを丸ごと
            re-exportしており、colorsだけを取り出せない。@futary/ui経由で
            importすると、この静的書き出しを実行するNode側のバンドルに
            react-nativeが入ってしまう。apps/landing/style.cssが同じ理由で
            パレットを丸写ししているのと同じ事情 */}
        <meta name="theme-color" content="#F5868D" />
        {/* 039: 外観（ピンク/ホワイト）。静的書き出し（web.output: "static"）の HTML は
            ピンクで prerender されているため、ホワイトを選んだ端末では JS が届いて
            hydrate するまでピンクが見える（B が本番相当ビルドで実測: localhost でも
            約110ms、4G相当で約1秒、低速3G相当で約8秒。artifacts/039/prerender/）。
            この inline script は localStorage の保存値（packages/ui/src/appearance.tsx の
            APPEARANCE_STORAGE_KEY と同じ "futary.appearance"）を同期で読み、ホワイト
            なら <html data-appearance="white"> を付ける。下の <style> がその間 #root を
            隠す（body の地は白なので、ピンクではなく白の空白が見える）。
            AppearanceProvider がホワイトで描き終えた後に属性を外す。
            利用者の入力を一切含まない静的な文字列で、CSP は scripts/build-public.mjs が
            この script の sha256 を script-src に足す（'unsafe-inline' にはしない）。
            @futary/ui を import しない理由は theme-color と同じ（上のコメント）。
            値の対応は apps/app/test/appearance.test.tsx がこのファイルの文面で検査する */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("futary.appearance")==="white"){document.documentElement.setAttribute("data-appearance","white")}}catch(e){}',
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: 'html[data-appearance="white"] #root{visibility:hidden}',
          }}
        />
        {/* 035書体仕様2節: 数字・欧文専用のPoppins（SIL OFL）をself-host。
            Google FontsのCDNは書かない（CSPで落ちる。font-src 'self'のまま）。
            latinサブセットのみ、1ウエイト約8KB。日本語本文には使わない
            （fontFamily.numericを当てた要素だけがここへ辿り着く）。
            500は「会った日数」の数字・COMING SOON、800は72ptの記念日
            数字に使う（700 vs 800はAの指示で実測比較し、800を採用した） */}
        {/* 039 段階2: 300 はホワイトのホームのロゴ文字「futary」（細いジオメトリック欧文）
            専用。Google Fonts の latin サブセット（fonts.gstatic.com/s/poppins/v24/
            pxiByp8kv8JHgFVrLDz8Z1xlFQ.woff2）を 035 と同じ置き方で self-host。約 8KB */}
        <link rel="preload" href={`${baseUrl}/fonts/poppins-300.woff2`} as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href={`${baseUrl}/fonts/poppins-500.woff2`} as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href={`${baseUrl}/fonts/poppins-800.woff2`} as="font" type="font/woff2" crossOrigin="" />
        {/* @font-faceはCSSとしてのみ書ける。外部URLを含まない静的な
            文字列であり、利用者の入力は一切含まない */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @font-face {
                font-family: 'Poppins';
                font-style: normal;
                font-weight: 300;
                font-display: swap;
                src: url('${baseUrl}/fonts/poppins-300.woff2') format('woff2');
              }
              @font-face {
                font-family: 'Poppins';
                font-style: normal;
                font-weight: 500;
                font-display: swap;
                src: url('${baseUrl}/fonts/poppins-500.woff2') format('woff2');
              }
              @font-face {
                font-family: 'Poppins';
                font-style: normal;
                font-weight: 800;
                font-display: swap;
                src: url('${baseUrl}/fonts/poppins-800.woff2') format('woff2');
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

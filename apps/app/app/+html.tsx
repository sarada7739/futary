import { ScrollViewStyleReset } from "expo-router/html";

// 既定のテンプレートには apple-touch-icon・manifest の <link> が無く、iOS はホーム画面にページの
// スクリーンショットを置く（favicon は app.json から自動で出るので足さない。030）。
// `/app/...` を直書きすると baseUrl の環境で外れるので、静的書き出しで baseUrl（"/app"）が入る
// EXPO_BASE_URL を使う
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
        {/* ホーム画面に出る名前。開き方（display: browser）は変えない。apple-mobile-web-app-capable は入れない
            （standalone だとホーム画面から開いたとき Safari の枠が消え、Google ログインから戻ってこないことがある） */}
        <meta name="apple-mobile-web-app-title" content="Nisoine" />
        {/* colors.primary と同じ値のリテラル。@futary/ui から import すると、静的書き出しを行う Node 側のバンドルに
            react-native が入る（index.ts が components を丸ごと re-export している）。landing の style.css と同じ事情 */}
        <meta name="theme-color" content="#F5868D" />
        {/* 外観の先読み（039）。HTML はピンクで prerender されているので、ホワイトを選んだ端末では hydrate まで
            ピンクが見える（4G 相当で約 1 秒、低速 3G で約 8 秒。artifacts/039/prerender/）。この script が保存値
            （appearance.tsx の APPEARANCE_STORAGE_KEY と同じ "futary.appearance"）を同期で読み、ホワイトなら
            <html data-appearance="white"> を付け、下の <style> がその間 #root を隠す（白の空白が見える）。
            Provider がホワイトで描き終えたら外す。利用者の入力を含まない静的な文字列で、CSP は Worker が配信する HTML
            から sha256 を足す（'unsafe-inline' にしない）。値の対応は apps/app/test/appearance.test.tsx が文面で見る */}
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
        {/* 数字・欧文専用の Poppins（SIL OFL）を self-host する（Google Fonts の CDN は CSP で落ちる。font-src 'self'）。
            latin のサブセットで 1 ウエイト約 8KB。日本語には使わない */}
        {/* 500 は会った日数の数字、800 は 72pt の記念日の数字 */}
        <link rel="preload" href={`${baseUrl}/fonts/poppins-500.woff2`} as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href={`${baseUrl}/fonts/poppins-800.woff2`} as="font" type="font/woff2" crossOrigin="" />
        {/* @font-face は CSS でしか書けない。外部 URL も利用者の入力も含まない静的な文字列 */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
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

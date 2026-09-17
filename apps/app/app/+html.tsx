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

// 061: 湾曲ガラスのタブバーが使う SVG フィルタ。
//
// なぜ +html.tsx に置くか: CSS の `filter: url(#id)` は「同じ文書の中にある」
// フィルタしか引けない。画面側で描くと、タブバーが載っていない画面で定義が
// 消えて参照が壊れる（参照が解決できないフィルタを指定した要素は、仕様上
// 描画されなくなる）。文書に1度だけ置くこの場所が、消えない唯一の置き場。
// react-native-svg は入れない（依存を増やさないため。packages/ui の方針と同じ）。
//
// 変位マップ（feDisplacementMap の in2）は、R に横・G に縦のランプを焼いた画像。
// 中央を 0x80（= 変位 0）で平らにし、両端に向かってだけ値を振ることで、
// 「フチに近いほど歪み、中央はほぼ素通し」という形を作る。turbulence の
// ランダムノイズでは中央も一様に歪むため使わない。
// 3枚目の青い矩形は B チャンネルを埋めるためだけのもの（変位には使わない）。
const DISPLACEMENT_MAP_SVG = [
  "<svg xmlns='http://www.w3.org/2000/svg' width='360' height='72'>",
  "<defs>",
  "<linearGradient id='gx' x1='0' y1='0' x2='1' y2='0'>",
  "<stop offset='0' stop-color='#000000'/>",
  "<stop offset='0.22' stop-color='#800000'/>",
  "<stop offset='0.78' stop-color='#800000'/>",
  "<stop offset='1' stop-color='#ff0000'/>",
  "</linearGradient>",
  "<linearGradient id='gy' x1='0' y1='0' x2='0' y2='1'>",
  "<stop offset='0' stop-color='#000000'/>",
  "<stop offset='0.34' stop-color='#008000'/>",
  "<stop offset='0.66' stop-color='#008000'/>",
  "<stop offset='1' stop-color='#00ff00'/>",
  "</linearGradient>",
  "</defs>",
  "<rect width='360' height='72' fill='url(#gx)'/>",
  "<rect width='360' height='72' fill='url(#gy)' style='mix-blend-mode:screen'/>",
  "<rect width='360' height='72' fill='#0000ff' style='mix-blend-mode:screen'/>",
  "</svg>",
].join("");

const DISPLACEMENT_MAP = `data:image/svg+xml,${encodeURIComponent(DISPLACEMENT_MAP_SVG)}`;

// 屈折の強さ（feDisplacementMap の scale）だけが外観で違うため、フィルタを
// 2本に分ける。id は packages/ui/src/theme.ts の glass.filterId と対で持つ
// （片方だけ直すと参照が壊れるため、apps/app/test/glass-tab-bar.test.tsx が
// 2つの id の一致を検査する）
function glassFilter(id: string, scale: number): string {
  return (
    `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
    `<feImage href="${DISPLACEMENT_MAP}" preserveAspectRatio="none" result="map"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}"` +
    ` xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>`
  );
}

const GLASS_FILTER_DEFS =
  `<svg width="0" height="0" focusable="false" aria-hidden="true"` +
  ` style="position:absolute;width:0;height:0;overflow:hidden"><defs>` +
  glassFilter("nisoine-glass-pink", 26) +
  glassFilter("nisoine-glass-white", 12) +
  `</defs></svg>`;

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
        <meta name="apple-mobile-web-app-title" content="Nisoine" />
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
        {/* 039 段階2の 300（ホワイトのホームの文字ロゴ）は 051 でロゴが両モード同じ画像になり、
            使う要素が無くなった。preload と @font-face を外し、public/fonts/poppins-300.woff2 も消した */}
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
      <body>
        {/* 061: ガラスのタブバーが引く SVG フィルタ。上のコメント参照。
            スクリプトでもスタイルでもないため CSP のハッシュは要らない */}
        <div
          style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
          dangerouslySetInnerHTML={{ __html: GLASS_FILTER_DEFS }}
        />
        {children}
      </body>
    </html>
  );
}

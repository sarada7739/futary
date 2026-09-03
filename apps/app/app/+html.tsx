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
        <meta name="theme-color" content="#F5868D" />
      </head>
      <body>{children}</body>
    </html>
  );
}

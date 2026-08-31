# 015: ランディングページ 検証結果

## 実装内容

- `apps/landing/index.html`・`style.css`・`assets/`: 素のHTML/CSS（ADR-002。RN Webを使わない）
- `scripts/build-public.mjs`: `apps/landing` と `apps/app` の Web export（`/app/*`）を
  `apps/api/public/` へ合成するビルドスクリプト。CSPを含む `_headers` を生成する
- `apps/api/wrangler.toml`: `[assets]` セクションを追加。`run_worker_first` は
  `/api/*` だけに絞り、`/` と `/app/*` は静的アセットとしてWorkerを経由せず配信する
- `apps/app/app.json`: `web.output = "static"`・`experiments.baseUrl = "/app"` を設定

## ルーティング構成の検証（ローカルで `wrangler dev` に実ビルドを配信させて確認）

`pnpm build:public` でビルドし、`apps/api` を `wrangler dev --local` で起動して確認した。

| パス | 期待 | 実測 |
|---|---|---|
| `/` | LP（`apps/landing/index.html`） | 200。OGP・タイトル・descriptionを含むHTMLが返る |
| `/app/` | アプリのサインイン画面 | 200。実際にログイン/ゲスト導線が表示される |
| `/app/calendar` | アプリのカレンダー画面（動的セグメント無しのため実ファイルとして存在） | 200 |
| `/api/health/get` | 既存のAPI | 200。JSONが返る |

`apps/app` は動的ルート（`[id].tsx`等）を持たないため、`expo export --platform web`
（`output: "static"`）が全26ルートを実ファイルとして書き出す。そのため `/app/*` に
SPAフォールバックのロジックが不要（Cloudflareの静的アセット配信の既定
`html_handling: auto-trailing-slash` が `/app/calendar` → `calendar.html` を
そのまま解決する）。

## 重大なバグを発見・修正（ビルドして初めて顕在化した）

**`apps/app/lib/api-origin.ts` が本番ビルドに `http://localhost:8787` を焼き込んでいた。**

- 元のコードはモジュール直下の定数式（`export const apiOrigin = ENV ?? (typeof window !== "undefined" ? ... : "http://localhost:8787")`）
- `expo export --platform web`（`output: "static"`）のビルド時最適化が `typeof window` を
  ビルド時に固定値へ畳み込み、**ブラウザ向けの実際の配布バンドルにまで
  `"http://localhost:8787"` が定数として焼き込まれる**ことをビルド後のJSを
  `grep`して発見した（`const t="http://localhost:8787"` という形で出現）
- 実機（ビルド済みバンドルを `wrangler dev` で配信）で確認したところ、
  この状態では**未認証のゲスト閲覧が動かない**: `couple.get` が
  `http://localhost:8787` へ接続しようとし、CSPの `connect-src` によって
  ブロックされる（本番では単純に接続失敗する）。「いまデモを見られません」
  （014のR-1修正）が表示され、原因の特定に至った
- `apiOrigin` を関数（`getApiOrigin()`）に変更し、`orpc.ts` の `RPCLink` には
  `url: () => \`${getApiOrigin()}/api\`` という遅延評価の関数を渡す形に修正した。
  `auth-client.ts` の `baseURL` も `getApiOrigin()` の呼び出し結果に変更した
- 修正後、同一構成で再検証し、`couple.get`・`stats.get` が正しく
  `http://127.0.0.1:<port>/api/...`（同一オリジン）へ届き、デモのホーム画面
  （ゆい・れんの記念日カード等）が正しく表示されることを確認した

**この不具合は014・016のどのタスクでも見つからなかった。**`apps/app` を
`expo start --web`（開発サーバー）でしか動かしていなかったため、
`window` が常に定義されている環境でしか実行されておらず、
`expo export`（静的ビルド）を初めて実行した015で顕在化した。

## CSP

`scripts/build-public.mjs` が `_headers` を生成する。

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-<実測値>'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.r2.cloudflarestorage.com; font-src 'self'; connect-src 'self' https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

- `script-src` は `'unsafe-inline'` を使わず、Expo Routerが埋め込む唯一のインライン
  script（`globalThis.__EXPO_ROUTER_HYDRATE__=true;`。全26ページで内容が同一であることを
  `sha256sum` で確認済み）のSHA256ハッシュだけを許可する。ビルドのたびに実測して
  ハッシュを計算するため、Expoのバージョンが変わってテンプレートが変わっても
  追従する
- `style-src` は `'unsafe-inline'` を許可している。React Native Webがインライン
  `style` 属性を多用するため（`nonce`/`hash`方式は動的に生成される値のため
  現実的でない）。CSSインジェクションのリスクはXSS経由の攻撃と同程度に留まり、
  この構成での既知の対策範囲として妥当と判断した
- `connect-src`/`img-src` に R2 の S3互換APIオリジン（`https://*.r2.cloudflarestorage.com`）を
  含める（署名付きURLで画像を直接取得・アップロードするため）
- `frame-ancestors 'none'` はmetaタグでは効かない（HTTPヘッダでしか設定できない）ため、
  `_headers` ファイルで設定する意味がある

`wrangler dev --local` でCSPヘッダが実際に付与されることを `curl -I` で確認済み
（`Parsed 1 valid header rule` のログも確認）。

## OGP・メタ情報

- `og:title`・`og:description`・`og:image`（1200x630のPNG。ロゴとタグラインを配置）・
  `og:type`・`og:site_name`・`og:locale`
- `twitter:card`（`summary_large_image`）・`twitter:title`・`twitter:description`・`twitter:image`
- `lang="ja"`・`<title>`・`<meta name="description">`
- **`og:image`・`twitter:image` は相対パス（`/assets/ogp.png`）のまま。**
  公開ドメインが未決（論点L1。`docs/tasks/015-landing-page.md`の停止条件どおり
  `*.workers.dev` で進める）のため、絶対URLを確定できない。**016でドメインが
  決まった時点で絶対URLへ直すこと。** SNSのカードプレビューでの実際の展開確認も
  実際に公開されたHTTPS URLが無いと行えないため、016のデプロイ後に確認する

## Webフォント・レイアウトシフト・横スクロール

- `style.css` はシステムフォントスタックのみ（`-apple-system`・`Hiragino Sans`・
  `Yu Gothic`等）。外部フォントの読み込みは無い
- `<img>` タグには `width`/`height` を指定済み（ロゴ・機能アイコン）
- モバイル幅（375px）で `document.documentElement.scrollWidth === clientWidth` を
  確認し、横スクロールが発生しないことを確認済み（ブラウザで実測）

## 技術構成セクションの正確性

`docs/decisions.md` から4件のADR（認可の集約・events統合・思い出しの一般化・
デモは未認証閲覧専用）を抜粋。実装（`architecture.md`・`security-requirements.md`）と
食い違いが無いことを確認済み。

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

`scripts/build-public.mjs` が `_headers` を生成する。security-auditorのレビューを受けて
初版から以下を修正済み（詳細は下の「Rレビュー・security-auditor指摘の解消」参照）。

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-<実測値>'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://<accountId>.r2.cloudflarestorage.com https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self' blob: https://<accountId>.r2.cloudflarestorage.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

- `script-src` は `'unsafe-inline'` を使わず、Expo Routerが埋め込む唯一のインライン
  script（`globalThis.__EXPO_ROUTER_HYDRATE__=true;`）のSHA256ハッシュだけを許可する。
  **全HTMLファイルを走査して内容が同一であることを確認**した上でハッシュを計算する
  （初版は1ファイルだけの実測だった。ビルドのたびに実測するため、Expoのバージョンが
  変わってテンプレートが変わっても追従する）
- `style-src` は `'unsafe-inline'` を許可している。React Native Webがインライン
  `style` 属性を多用するため（`nonce`/`hash`方式は動的に生成される値のため
  現実的でない）。CSSインジェクションのリスクはXSS経由の攻撃と同程度に留まり、
  この構成での既知の対策範囲として妥当と判断した
- `connect-src`/`img-src` に R2 の署名付きURLのホストを**実アカウントIDで固定**して
  含める（`https://<accountId>.r2.cloudflarestorage.com`。ワイルドカード
  `https://*.r2.cloudflarestorage.com`だと、XSS成立時に攻撃者自身のR2バケットへの
  持ち出しまで許してしまうため。`readR2AccountId()`が`.dev.vars`または環境変数から
  読み、取得できなければビルドを失敗させる〈fail-closed〉）
- `img-src`/`connect-src` に `blob:` を追加。`expo-image-picker`・
  `expo-image-manipulator`のWeb実装が`URL.createObjectURL()`を使うため、
  これが無いと本番ビルドで画像投稿・プロフィール画像設定が失敗する
- `img-src` にGoogleのプロフィール画像ホスト（`https://lh3.googleusercontent.com`）を
  追加。`resolveUserImage`が自前アップロード画像が無いユーザーにGoogleアバターURLを
  そのまま返すため
- `form-action 'self'` を追加（フォーム送信先を自オリジンに限定）
- `Strict-Transport-Security`（HSTS）を追加
- `frame-ancestors 'none'` はmetaタグでは効かない（HTTPヘッダでしか設定できない）ため、
  `_headers` ファイルで設定する意味がある

`wrangler dev --local` でCSPヘッダが実際に付与されることを `curl -I` で確認済み
（`Parsed 1 valid header rule` のログ、および`Strict-Transport-Security`ヘッダの
存在も確認）。

## Rレビュー・security-auditor指摘の解消（PR #170）

R-1〜R-4およびsecurity-auditorのMedium/Low指摘を受けて修正し、いずれも実機で再確認した。

- **R-1（`auth-client.ts`が`orpc.ts`と違い`getApiOrigin()`を遅延評価していないのでは）**:
  `baseURL: getApiOrigin()`はモジュール読み込み時に1回だけ評価される点はR指摘の通り。
  ただし修正の効果は「呼び出しタイミングを遅延させたこと」ではなく「`getApiOrigin`を
  本物の関数にしたことでビルド時定数畳み込みを防いだこと」に由来するため、
  モジュール直下での1回評価でも問題は起きない。実機で検証: ビルド済みバンドルを
  `wrangler dev`で配信した状態で「ログイン」ボタンを押し、リクエストが
  `http://127.0.0.1:<port>/api/auth/sign-in/social`（同一オリジン）へ飛ぶことを確認した。
  **レスポンスの403については当初「`.dev.vars`のGoogle OAuth設定に起因する別問題」と
  書いたが、これは未検証の推測だった（Rから指摘を受け、原因を特定した。下の
  「403の実際の原因」参照）**
- **R-2（`EXPO_PUBLIC_API_ORIGIN`を空文字で上書きする措置は本当に必要か、関数化だけで
  足りているのでは）**: 空文字上書きを外した状態（`.env`の実際の値を残したまま）で
  再ビルドし、生成された配布バンドルを`grep`したところ、`getApiOrigin`関数の本体は
  `process.env.EXPO_PUBLIC_API_ORIGIN`という実行時参照のまま残っており、
  `.env`の値が文字列として畳み込まれていないことを確認した。つまり関数化の対策
  単独で再発は防げている。空文字上書きは、将来Metroの環境変数インライン化の挙動が
  変わった場合に備えた多層防御として残した（`scripts/build-public.mjs`のコメント参照）。
  「なぜMetroがここでは値をインライン化しないのか」の内部機構までは特定できておらず、
  この点は未確認のまま残る
- **R-3（`getApiOrigin()`のコメントが実測の経緯を正確に反映していない）**:
  `apps/app/lib/api-origin.ts`・`scripts/build-public.mjs`のコメントを、上記R-1・R-2の
  実測結果を踏まえて書き直した
- **R-4（`assertNoLocalDevOriginLeaked`が実際には判別できていない）**: Rの指摘どおり、
  初版は「ファイル全体に`location.origin`という文字列があるか」を見ており、
  `better-auth`・`expo-router`など無関係な依存が同じチャンクに`location.origin`を
  含むため常に素通りしていた（実測で確認: 該当箇所を壊した状態でもビルドが通った）。
  「localhostの近傍〈前後300文字〉に`typeof window`があるか」という2回目の修正も、
  `better-auth`のホスト判定関数や`expo-router`のエラーメッセージ文字列が無関係に
  "localhost"を含み、かつ`typeof window`を伴わないため誤検知した（実測で確認:
  正しいコードでもビルドが落ちた）。最終的に「`http://localhost:8787`という
  ポート番号込みの具体的なリテラル（getApiOrigin()以外が持つ理由の無い文字列）を
  探し、その近傍に`typeof window`があるか」に変更し、現状の正しいコードで
  誤検知しないことを実測で確認した。
  **ただし、Rの依頼どおり「api-origin.tsを壊れたバージョンに戻して実際に例外が
  飛ぶこと」の証明はできなかった**: `getApiOrigin`を元のモジュール直下の定数式
  （`export const apiOrigin = ... ? window.location.origin : "http://localhost:8787"`。
  `orpc.ts`側も`url: () => ...`の関数呼び出しをやめ、`apiOrigin`定数を直接
  テンプレートリテラルに埋め込む形。015で報告されたバグの構造そのもの）に3パターン
  戻して再ビルドしたが、いずれも`typeof window`の分岐は畳み込まれず、コンパイル後の
  バンドルにも生きた分岐として残った（`grep`で確認）。つまり**現在のツールチェーンで
  015の不具合を再現できなかった**。当時実際に観測した「本番バンドルにconstとして
  焼き込まれた」現象の正確な発生条件は依然として特定できておらず（Metroのバージョン差・
  キャッシュ状態・SSGとクライアントバンドルの共有条件など、複数の未検証の仮説が残る）、
  このチェックが「元のバグと全く同じ壊れ方」を捕まえられるという保証はできない。
  提供できるのは「フォールバックのリテラル文字列が`typeof window`の生きた分岐の外に
  裸で存在すれば検知する」という、症状ベースの検知ロジックであることの実測確認まで
- **security-auditor Medium**: R2 CSPワイルドカード→実アカウントID固定（上記CSP節）
- **security-auditor Low**: `blob:`欠落によるアップロード破壊の可能性、
  Googleアバターホスト欠落、`form-action`欠落、HSTS欠落、インラインscriptハッシュの
  1ファイルのみの実測、ローカル開発オリジン焼き込みの再発防止チェック
  （`assertNoLocalDevOriginLeaked`）を追加 — いずれも対応済み

### 403の実際の原因（R指摘により特定）

`resolveCallbackURL()`（`apps/app/app/(auth)/sign-in.tsx`）はWebで
`window.location.origin`を`callbackURL`として`signIn.social()`に渡す。
ビルド済みバンドルを任意のポート（例: `http://127.0.0.1:8794`）で配信して
ログインボタンを押すと、`callbackURL`が`http://127.0.0.1:8794`という絶対URLになり、
これが`.dev.vars`の`TRUSTED_ORIGINS`（`http://localhost:8081,http://127.0.0.1:8081,
http://localhost:19006`。Expo開発サーバーのポートのみ）に含まれないため、Better Authが
`{"message":"Invalid callbackURL","code":"INVALID_CALLBACK_URL"}`（403）を返す。
`curl`で`callbackURL`を相対パス（`"/"`）にすると200で通ることと、絶対URLにすると
403になることの両方を実測して切り分けた。**「Google OAuth設定に起因する別問題」という
当初の記述は誤りで、削除する。**

この403自体はローカル開発でのポートの組み合わせに起因するテスト環境固有の問題であり、
015のコード変更が原因ではない。ただし**015が本番のオリジン構成を変えた**ことは事実で、
これまで別オリジンだった`apps/app`（8081）と`apps/api`（8787）が本番では同一Workerの
単一オリジンになる。**016で`BETTER_AUTH_URL`・`TRUSTED_ORIGINS`を本番の実際のオリジン
（`*.workers.dev`のURL）に正しく設定しないと、本番でも同じ`INVALID_CALLBACK_URL`で
ログインが失敗する。**016の確認項目に「ログインが200で完了すること」を明示的に追加する。

### CIとpredeployについて（記録）

`assertNoLocalDevOriginLeaked`もCSPハッシュの実測も`apps/api/package.json`の
`predeploy`スクリプト（`scripts/build-public.mjs`）でのみ実行され、CIの
`pnpm -w test`・`eslint .`・`pnpm -r type-check`では実行されない。デプロイを
止める位置にあるため置き場所としては妥当だが、CIが緑であることはこれらのチェックが
実際に動いたことを意味しない。また、今回実機確認したゲスト閲覧フローは画像投稿も
ログインもしないため、`blob:`・`lh3.googleusercontent.com`をCSPに追加した効果は
理屈の上のものに留まり、実際に通してはいない。016でこれらが初めて実際に使われる。

修正後、全体テスト（`pnpm -w test`: apps/app 150件・apps/api 297件）・lint
（`eslint .`）・型チェック（`pnpm -r type-check`）が通ることを確認し、
新CSPでのゲスト閲覧フロー（`couple.get`・`stats.get`が200、全アセットが読み込まれ、
デモのホーム画面が正しく表示される）を`wrangler dev`実ビルド配信で再確認した。

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

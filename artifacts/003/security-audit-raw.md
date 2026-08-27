# 003 security-auditor 生の返答

監査役（`.claude/agents/security-auditor.md`、Read/Grep/Globのみ）が返した報告をそのまま貼り付ける。
一切編集していない。

---

`docs/security-requirements.md` と対象ファイル全件、および `node_modules` 内の Better Auth 1.7.2 / hono 4.13.5 / oRPC 1.15.0 の実装を読んで裏を取りました。以下が報告です。そのまま2箇所に転記してください。

---

### [2026-08-27] 監査対象: 003 認証基盤（Google OAuth） — apps/api/src/{auth,index,router}.ts, wrangler.toml, packages/db/src/schema/auth.ts, packages/db/migrations/0001_auth.sql, packages/contract/src/me.ts, apps/app/lib/{auth-client,orpc,api-origin}.ts, apps/app/app/{_layout.tsx,(auth)/sign-in.tsx,(tabs)/profile.tsx}, .dev.vars.example, .github/workflows/ci.yml

| 重大度 | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| High | `apps/api/wrangler.toml:19` | `BETTER_AUTH_URL = "http://localhost:8787"` が共通 `[vars]` にあり、`[env.production.vars]` が存在しない。Better Auth はセッションCookieの `Secure` 属性と `__Secure-` プレフィックスを `baseURL.startsWith("https://")` だけで決める（`better-auth/dist/cookies/index.mjs:23`、`secure: !!secureCookiePrefix` が同 34行）。このまま `wrangler deploy` すると本番のセッションCookieに `Secure` が付かない。要件2節「`HttpOnly`/`Secure`/`SameSite=Lax`」に違反。**根拠**: 悪用にはHTTPへの誘導という一手間が要るが、影響はセッション奪取＝全データ閲覧で、しかも設定ミスが現在確定的に存在する | `[env.production.vars]` に実ドメインの `https://...` を置き `--env production` でデプロイする。加えて保険として `advanced: { useSecureCookies: true }` を `auth.ts` に明示する（baseURL の綴りミスに依存しなくなる） |
| High | `apps/api/src/auth.ts:16` | `secret: env.BETTER_AUTH_SECRET` を検証せずに渡している。Better Auth は secret が falsy のとき公開定数 `"better-auth-secret-12345678901234567890"` にフォールバックし（`better-auth/dist/context/create-context.mjs:78`）、それを**例外にするのは `isProduction` が真のときだけ**（同 41行）。`isProduction` は `process.env.NODE_ENV === "production"`（`@better-auth/core/src/env/env-impl.ts:52`）で、`NODE_ENV` は `wrangler.toml` のどこにも設定されていない。Worker 上で `NODE_ENV` が未定義ならこの安全弁は作動せず、`wrangler secret put BETTER_AUTH_SECRET` を忘れた瞬間に**誰でも署名可能な鍵でセッションCookieが発行される**（＝任意ユーザーへのなりすまし）。**根拠**: 発生条件は「secret 設定漏れ」1つだけで、成立した場合の影響は全アカウント乗っ取り | `createAuth` の冒頭で fail-fast させる（例: `if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error("BETTER_AUTH_SECRET が未設定です")`）。ライブラリ側の本番判定に依存しない。あわせて Worker 上での `process.env.NODE_ENV` の実値を1度実測し、`docs/` に記録すること（後述の rate limit 判定にも効く） |
| Medium | `apps/api/wrangler.toml:20` ＋ `apps/api/src/index.ts:26-33` ＋ `apps/api/src/auth.ts:24` | `TRUSTED_ORIGINS` に `http://localhost:8081,http://127.0.0.1:8081,http://localhost:19006` が共通 `[vars]` として入っており、本番にもそのまま載る。これは CORS の `credentials: true` 許可リストであると同時に Better Auth の `trustedOrigins` でもある。被害者のマシンの `localhost:8081` で動く任意のコンテンツから、本番APIへ認証付きクロスオリジン要求を出して**レスポンスを読める**。**根拠**: 攻撃には被害者ローカルでの実行という前提が要るため Critical ではないが、成立時は投稿本文まで到達する | 本番用 `[env.production.vars]` では実オリジンのみ（同一オリジン配信なら空文字）にし、localhost 群は dev 専用の上書き（`[env.dev.vars]` か `.dev.vars`）に移す。「1つの変数に開発値を入れて本番で上書きし忘れる」構造そのものを断つ |
| Medium | `apps/app/app.json:5` ＋ `apps/api/src/auth.ts:31` | ネイティブ復帰経路でセッショントークンがURLに載る。Expoプラグインはコールバック後、カスタムスキームへのリダイレクトURLに `redirectURL.searchParams.set("cookie", cookie)` として **`Set-Cookie` 全体（＝セッショントークン）をクエリパラメータに詰める**（`@better-auth/expo/dist/index.js:79-82`）。要件1節「セッショントークンをURLクエリに載せない」と正面から衝突する。さらに `scheme: "futary"` は検証なしのカスタムスキームで、Android では同一スキームを登録した別アプリがディープリンクを横取りできる＝トークン窃取。現状は `futary://` が `TRUSTED_ORIGINS` に無いため `isTrustedOrigin` が偽になりこの分岐に入らない（fail-closed で結果的に安全）が、ネイティブログインを通すために必ず追加されることになる。**根拠**: Android のスキーム衝突は実装容易、影響はセッション奪取 | 検証済みディープリンク（iOS Universal Links / Android App Links）に切り替える。それが重いなら、`futary://` を許可する前に ADR として「受容したリスクである」と明記し、セッション有効期限を短くする・ネイティブ用トークンだけ寿命を切る等の緩和を書く。無自覚に `TRUSTED_ORIGINS` へ足すのが最悪 |
| Medium | `apps/api/src/auth.ts:31` ＋ `apps/api/src/index.ts:37` | オープンリダイレクト。`plugins: [expo()]` により `GET /api/auth/expo-authorization-proxy` が Web からも到達可能になっている。実装は `authorizationURL` が https かつ baseURL と別オリジンであることしか検査せず、`oauthState` が付いていれば無条件に `ctx.redirect(authorizationURL)` する（`@better-auth/expo/dist/index.js:15-29`）。futary の正規ドメインを踏み台にしたフィッシング誘導が成立する。**根拠**: URLを1本組むだけで悪用可能。影響は認証情報の直接漏洩ではなくフィッシング補助に留まる | ネイティブがこのプロキシを使わないなら、Hono 側で `/api/auth/expo-authorization-proxy` を 404 として塞ぐ。使うなら遷移先を Google の認可エンドポイントのホストに限定する |
| Medium | `apps/api/src/auth.ts:14-32`（`rateLimit` 未設定） | レート制限が実質的に効いていない。既定は `enabled: options.rateLimit?.enabled ?? isProduction`、`storage: "memory"`（`create-context.mjs:171,174`）。前述のとおり Worker で `NODE_ENV` が未設定なら `enabled` は false。仮に true でも、Workers の memory ストレージはアイソレートごと・短命なので実効性がない。OAuth エンドポイントが無防備で、要件4節・T2（招待コード総当たり）を実装する段になっても土台がない | `rateLimit: { enabled: true, storage: "database" }` を明示し、`rateLimit` テーブルを次のマイグレーションに含める（D1でよい）。招待コードのIP単位制限もこの基盤に載せる |
| Low | `.github/workflows/ci.yml:23-27` | T6/T7 の CI 統制が未実装。`pnpm audit` ステップも gitleaks ステップも無く、`.github/dependabot.yml` も存在しない。要件97-98行が「CIで実行する」と明記している対策が、手動実行に依存している状態 | CI に `pnpm audit --prod --audit-level=high` と gitleaks を追加し、Dependabot 設定を置く。今回 gitleaks が「環境に無かったので未実行」で済んでしまったのは、この欠落の直接の帰結 |
| Low | `apps/api/src/index.ts:42-62`（`app.onError` 不在）／`apps/api/src/router.ts:13` | 要件8節「サーバ内部のエラーは一意なIDを振り、クライアントにはIDのみ返す」が未実装。なお**クライアントへの漏洩は無い**ことは確認済み: oRPC は非 `ORPCError` を `new ORPCError("INTERNAL_SERVER_ERROR", { message: "Internal server error", cause: error })` に包み（`@orpc/client/dist/shared/client.CZlviB0y.mjs:167-172`）、`cause` は `toJSON()` で送出されない。問題は逆側で、サーバ側にも記録が残らず障害追跡ができない | `app.onError` を追加し、UUID を採番してサーバログにはID＋エラー種別のみ（本文・メール・トークンは出さない）、クライアントにはIDのみ返す |
| Low | 全レスポンス（`apps/api/src/index.ts` 全体） | セキュリティヘッダが一切設定されていない。CSP・`Referrer-Policy`・`X-Content-Type-Options` が無い。要件7節は Web アプリへの CSP を求めている。`Referrer-Policy` 不在は上記オープンリダイレクトのリファラ漏れとも結びつく | Web 配信タスクの完了条件に CSP を含める。API 側にも `hono/secure-headers` で最低限（`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`）を付ける |
| Info | `@better-auth/expo/dist/index.js:46-60` | `expo()` サーバプラグインは、Origin ヘッダが無いリクエストに対して**攻撃者が指定可能な `expo-origin` ヘッダの値を Origin として設定し直す**。Better Auth の Origin 検査の前提を弱める挙動。ただしブラウザからは悪用不可（クロスサイトの認証付きPOSTでは Origin が必ず付き、カスタムヘッダ付与にはプリフライトが要り、本実装の CORS は完全一致オリジンにしか許可を出さない）。また `validateOrigin` は Cookie 無しリクエストで検査をスキップする設計（`origin-check.mjs:108`）なので、CSRF 面での実害は無い | 対応不要。ネイティブがヘッダ上書きを必要としないと判明した時点で `expo({ disableOriginOverride: true })` にする、という選択肢だけ記録しておく |
| Info | `apps/api/src/router.ts:4-7` ／ `apps/app/app/_layout.tsx:19-24` | 要件3節の「単一の防御線」はまだ存在しない。`RpcContext` は `db` と `user` のみで `coupleId` が無く、認可ミドルウェアも未実装。`Stack.Protected` はクライアント側の表示制御にすぎず、T5 が禁じる「UI側の制御への依存」そのもの。003 の時点では手続きが `health` と `me` しかないため実害なし | 005 以降、ペアスコープの手続きを1本でも追加する**前に**認可ミドルウェアを入れること。今の形のまま手続きを足すと必ず抜ける |

### 指摘に至らなかった確認事項（監査済み・問題なし）

- **CORS 実装そのものは正しい**（質問4への回答）。`hono/cors` は配列 origin を完全一致でしか照合せず、空配列なら `Access-Control-Allow-Origin` を一切返さない（`hono/dist/middleware/cors/index.js:22,39-42`）＝fail-closed。`*` は使われておらず、`Vary: Origin` も付与される（同 80-82行）。CORS ミドルウェアが `/api/auth/*` ハンドラより**先に**登録されている点も正しく、Hono は `c.res` 差し替え時に既存ヘッダを引き継ぐため認証ルートのレスポンスにも適用される。**環境変数化という設計判断は妥当で、残る問題は値の置き場所（上記 Medium）だけ**です。
- **`transaction: false` は妥当**（質問5）。`@better-auth/drizzle-adapter/dist/index.d.mts:37-43` に「DBがトランザクションを持たない場合は false にせよ、既定値も false」と明記されており、D1 に対する正しい選択。ただし副作用として user と account の作成が原子的でなくなるため、途中失敗で `account` を持たない孤児 `user` 行が残り得る。オンボーディング実装時に冪等性を確認してください（現時点では指摘に上げません）。
- **スキーマは Better Auth 1.7.2 標準と一致**（質問6）。`issuer` は実在し必須です（`better-auth/dist/db/schema.d.mts:29-44` の Account 型に `issuer: string` として非オプショナルで存在）。Session の項目も一致（同 45-54行）。削られたフィールド・緩められた制約はありません。`user.email` と `session.token` の UNIQUE、`user_id` の ON DELETE CASCADE もマイグレーション（`0001_auth.sql:16,28,31,42`）に反映済み。`password` 列は Google のみの構成では未使用ですが、標準スキーマの一部なので残して正解です。
- **秘密情報のリポジトリ混入なし**（質問7）。`.dev.vars.example:8,12,13` は3つとも値が空。`apps/api/.dev.vars` と `apps/app/.env` はディスク上に存在しますが `.gitignore:15-19` が捕捉しており（`!.dev.vars.example` / `!.env.example` の再包含も正しい順序）、`apps/app/.env` の中身は `EXPO_PUBLIC_API_ORIGIN` のみ。リポジトリ全体を `GOCSPX` / `apps.googleusercontent.com` / `-----BEGIN` / 値付き `BETTER_AUTH_SECRET=` で走査して該当なし。**ただし私は読み取り専用ツールしか持たず、`git log --all` によるコミット履歴の走査ができていません。**「今の作業ツリーに無い」ことしか保証していない点に注意してください。gitleaks の CI 組み込み（上記 Low）で埋めるべき穴です。
- **SecureStore の扱いは要件どおり**（質問1）。`apps/app/lib/auth-client.ts:4,19` で `expo-secure-store` を使い、Web では Cookie に委ねてプラグインを外している。`AsyncStorage` の使用箇所はありません。
- **Cookie の `HttpOnly` / `SameSite=Lax`** は Better Auth の既定（`cookies/index.mjs:35,37`）で、`advanced.defaultCookieAttributes` による上書きもしていないため要件どおり。危ういのは `Secure` だけです（上記 High）。
- **ログ・エラーからのトークン/スタックトレース漏洩なし**（質問3）。自前コードに `console.log` は皆無。Better Auth のログ出力箇所（`origin-check.mjs:56-57,78-79,114-115`）が出すのは不正URLと trustedOrigins 一覧のみでトークンは含まれない。telemetry も既定無効（`@better-auth/telemetry/dist/index.mjs:360` で `enabled` 既定 false、env 変数も未設定）で、外部送信は発生しません。
- **`coupleId` を引数に取る手続きは存在しない**（`packages/contract/src/me.ts` 全体）。要件3節の禁止事項は現時点で守られています。
- 生SQLは `router.ts:13` の `SELECT 1` のみで、外部入力の連結なし。`dangerouslySetInnerHTML` の使用箇所なし。

### `pnpm audit` の判断について

**「Workers 実行時のコードパスに含まれない」という予備判断は妥当**です。3件とも `devDependencies` 経由で、`main = "src/index.ts"` からのバンドルには入りません。ただし2点補足します。

1. **「本番に影響しない」＝「無害」ではありません。** esbuild の該当脆弱性（開発サーバが任意オリジンからのリクエストに応答しレスポンスを読まれる）は、`drizzle-kit` の開発サーバを起動している**開発者のマシン**が対象です。起動中に別タブで信頼できないサイトを開かない、という運用で緩和してください。`image-size` と `uuid` はビルド時にリポジトリ内の信頼できる入力しか処理しないため実質無害という判断で問題ありません。
2. **判断を毎回人間の記憶に頼らないでください。** CI に `pnpm audit --prod --audit-level=high` を入れれば、「本番依存かどうか」をツールが機械的に切り分けます（上記 Low 指摘）。今回のような「4件出たが全部開発用だと思う」という手動判定を繰り返す構造が、いずれ本番依存の1件を見落とします。

### まとめ

003 の実装の骨格は堅実です。CORS を fail-closed に直した点、SecureStore を使った点、スキーマを標準どおりに置いた点、`coupleId` を引数に出していない点は要件を正しく満たしています。

一方で、**危険は全て `wrangler.toml` の共通 `[vars]` に開発値を置いたことに集中しています**。`BETTER_AUTH_URL` が http のままなら Cookie の `Secure` が落ち、`TRUSTED_ORIGINS` が localhost のままなら本番の CORS が緩む。どちらも「デプロイ前に直すのを忘れなければ大丈夫」という形で残っており、それは対策とは呼べません。マージ前に `[env.production.vars]` を分離し、`BETTER_AUTH_SECRET` の fail-fast 検証（High 2件目）を入れてください。この2つは 004 以降に持ち越すべきではないと判断します。

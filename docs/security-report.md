# セキュリティ監査記録

`docs/security-requirements.md` 10節の手順に従い、`artifacts/NNN/security-audit-raw.md`
（監査役の生の返答）をそのまま転記する。B が対応した結果は各エントリの末尾に追記する。

---

## [2026-08-27] 003 認証基盤（Google OAuth）

対象: `apps/api/src/{auth,index,router}.ts`, `wrangler.toml`, `packages/db/src/schema/auth.ts`,
`packages/db/migrations/0001_auth.sql`, `packages/contract/src/me.ts`,
`apps/app/lib/{auth-client,orpc,api-origin}.ts`,
`apps/app/app/{_layout.tsx,(auth)/sign-in.tsx,(tabs)/profile.tsx}`,
`.dev.vars.example`, `.github/workflows/ci.yml`

生の返答: [`artifacts/003/security-audit-raw.md`](../artifacts/003/security-audit-raw.md)

| 重大度 | 箇所 | 内容 | 推奨対応 | 対応 |
|---|---|---|---|---|
| High | `apps/api/wrangler.toml:19` | `BETTER_AUTH_URL` が http 固定の共通 `[vars]` にあり、本番デプロイ時に上書きし忘れるとセッションCookieの `Secure` 属性が落ちる | `[env.production.vars]` に実ドメインを置く。`useSecureCookies` を明示する | **対応済み**。`BETTER_AUTH_URL` を `[vars]` から削除し `.dev.vars` / `wrangler secret` 経由に変更。未設定なら `createAuth` が起動時エラーで落ちる（fail-closed）。`advanced.useSecureCookies` を `BETTER_AUTH_URL` のプロトコルから明示的に算出するよう変更 |
| High | `apps/api/src/auth.ts:16` | `secret` を検証せず渡しており、未設定時は公開済みのデフォルト鍵にフォールバックしうる（Workers では `NODE_ENV` 未設定のため本番判定が効かない） | `createAuth` の冒頭で fail-fast させる | **対応済み**。`assertValidSecret` で32文字未満・未設定を例外にした。CIにも影響したため `.github/workflows/ci.yml` にテスト用ダミー `.dev.vars` を生成するステップを追加し、fail-fast動作をローカルで実地確認した |
| Medium | `wrangler.toml:20` ＋ `index.ts:26-33` ＋ `auth.ts:24` | `TRUSTED_ORIGINS` が localhost 固定で本番にも載る。同一マシン上の他アプリから本番APIへ認証付きクロスオリジン要求が通る | 本番用は実オリジンのみ（同一オリジン配信なら空）にし、dev専用の値と分離する | **対応済み**。`BETTER_AUTH_URL` と同様 `.dev.vars` / `wrangler secret` 経由に変更。未設定ならCORSはすべて拒否（fail-closed） |
| Medium | `apps/app/app.json:5` ＋ `auth.ts:31` | ネイティブ復帰経路で `@better-auth/expo` がセッショントークンをURLクエリに載せる。`futary://` スキームはAndroidで衝突しうる | 検証済みディープリンクへの切り替え、または受容リスクとしてADR化 | **未対応（記録のみ）**。現状 `futary://` を `TRUSTED_ORIGINS` に含めていないため経路自体が無効（fail-closed）。ネイティブのGoogleログイン対応時に必ず再検討が必要。`docs/state.md` の未解決論点に記録した |
| Medium | `auth.ts:31` ＋ `index.ts:37` | `@better-auth/expo` の認可プロキシがWebからも到達可能でオープンリダイレクトの踏み台になりうる | ネイティブ未対応なら該当エンドポイントを塞ぐ | **対応済み**。`GET /api/auth/expo-authorization-proxy` を明示的に404にするルートを追加。ネイティブ対応時に解除する |
| Medium | `auth.ts:14-32`（rateLimit未設定） | Workersでは `NODE_ENV` 未設定のため既定でレート制限が無効。memory storageも実効性が薄い | `rateLimit: { enabled: true, storage: "database" }` を明示 | **一部対応**。`rateLimit: { enabled: true }` を明示（storageは既定のmemoryのまま）。database storageへの切替と`rateLimit`テーブルは招待コード機能（004以降）実装時にまとめて対応する。`docs/state.md` の未解決論点に記録した |
| Low | `.github/workflows/ci.yml:23-27` | CIに `pnpm audit` / gitleaks / Dependabot が無い | CIに追加する | **未対応（記録のみ）**。003スコープ外として `docs/state.md` の未解決論点に記録した |
| Low | `index.ts:42-62`（`app.onError`不在） | サーバ内部エラーにIDを振っておらず障害追跡ができない（クライアントへの漏洩は無いことは確認済み） | `app.onError` でUUID採番 | **未対応（記録のみ）**。003時点では手続きが `health`/`me` のみで実害が薄いため見送り。posts等の実装時に対応する |
| Low | 全レスポンス | セキュリティヘッダ（CSP等）が無い | Web配信タスクで対応 | **未対応（記録のみ）**。Web配信・LP実装タスクのスコープとして `docs/state.md` に記録した |
| Info | `@better-auth/expo` のOrigin上書き挙動 | ブラウザからは悪用不可と確認 | 対応不要 | 対応不要（監査結論のとおり） |
| Info | `router.ts:4-7` ／ `_layout.tsx:19-24` | `coupleId` 集約の認可ミドルウェアがまだ無い。003時点では実害なし | 005以降、手続き追加前に必ず導入 | 対応不要（005のタスクスコープ） |

### pnpm audit（静的ツール）

検出4件（High 2 / Moderate 2）。いずれも `drizzle-kit` / `expo-cli` / `metro` 経由の
開発時・ビルド時依存で、Cloudflare Workers の実行時コードパスには含まれない。
監査役もこの判断を妥当と確認済み。詳細は `artifacts/003/security-audit-raw.md` 参照。

gitleaks はこの環境に無く未実行。CIへの導入は上表Lowの未解決論点として記録。

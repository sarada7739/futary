# 003 動作確認記録

## 自動テスト

`apps/api/test/{health,me}.test.ts`（Vitest + Miniflare/D1ローカル実体）。結果は
[`vitest-result.txt`](./vitest-result.txt) 参照。5件すべて緑。

- `me.get` が未認証で `null` を返す
- `/api/auth/get-session` が未認証で `200` + `null` を返す
- `/api/auth/sign-out` がセッション無しでも 5xx にならない
- `/api/auth/expo-authorization-proxy` が 404 で塞がれている（オープンリダイレクト対策）
- `health.get`（既存、001から継続）

`fail-fast` 検証（`BETTER_AUTH_SECRET` 未設定時に起動時エラーになること）は、
`.dev.vars` を一時退避して手動で確認済み（テストコードには含めていない。CI用の
ダミー `.dev.vars` を用意したため、通常のテスト実行では検証されない）。

## 手動確認（ブラウザ）

`wrangler dev`（apps/api, :8787）と `expo start --web`（apps/app, :8081）を起動して確認。
Google OAuth クライアントは未取得のため、`.dev.vars` にダミー値
（`GOOGLE_CLIENT_ID=dummy-client-id.apps.googleusercontent.com` 等）を入れて確認した。
**実際のGoogleログイン成功・D1へのユーザー作成・Cookie属性のブラウザ実地確認は未実施**
（ユーザー判断により後回し。人間がGoogle Cloud Consoleでクライアントを作成し、
`.dev.vars` を実際の値に差し替えた後、別途確認する）。

### 確認できたこと

1. **未認証時、`/(auth)/sign-in` に自動的にリダイレクトされる**
   `apps/app/app/_layout.tsx` の `Stack.Protected` が機能している。
   `http://localhost:8081` にアクセスすると、以下が表示された:
   ```
   futary
   大切な人と、ずっとつながるための
   ふたり専用SNS
   ログイン
   新しくはじめる
   ゲストではじめる
   ```
   「ゲストではじめる」は無効表示（disabled）で操作できない。

2. **「ログイン」ボタン押下で Google の OAuth 画面に正しく遷移する**
   `signIn.social({ provider: "google", ... })` → `POST /api/auth/sign-in/social`
   （200 OK）→ `https://accounts.google.com/...&client_id=dummy-client-id...` へ遷移。
   ダミークライアントIDのため Google 側で `エラー 401: invalid_client` になるが、
   これは実際のクライアントIDが未設定であることによるもので、futary 側のOAuth
   フロー構築（authorization URL の組み立て、redirect_uri の指定等）が正しいことを示す。

3. **CORS（クロスオリジンCookie付きリクエスト）が機能している**
   ネットワークログ:
   ```
   GET  http://localhost:8787/api/auth/get-session      → 200 OK
   POST http://localhost:8787/api/auth/sign-in/social    → 200 OK
   OPTIONS http://localhost:8787/api/auth/sign-in/social  → 204 No Content
   ```
   `localhost:8081` (Expo Web) から `localhost:8787` (API) への
   `credentials: include` 付きリクエストが `TRUSTED_ORIGINS` 環境変数の設定により
   正しく許可されている。ブラウザのコンソールエラーは無し。

4. **`BETTER_AUTH_SECRET` 未設定時、Worker が起動時エラーで落ちる（fail-closed）**
   `.dev.vars` を一時退避して `vitest run` を実行したところ、
   `me.get` / `/api/auth/get-session` の両方が `500 Internal Server Error` になった
   （`assertValidSecret` が例外を投げるため）。`.dev.vars` を戻すと即座に緑に戻った。

### 未確認（実クライアント入手後に別途確認する）

- 実際の Google アカウントでのログイン成功
- D1 の `user` / `account` テーブルにレコードが作られること
- ブラウザDevToolsでの Cookie 属性確認（`HttpOnly` / `Secure` / `SameSite=Lax`）
  — コードレベルでは Better Auth のデフォルト挙動と `useSecureCookies` の実装を
  確認済み（`docs/security-report.md` 参照）だが、実地確認ではない
- ログイン → リロード → ログイン状態維持
- ログアウト → `me.get` が `null` に戻ること（UIの導線としての確認。API単体は
  自動テストで確認済み）
- Expo SecureStore への保存（ネイティブ実機/シミュレータでの確認。この環境では
  ブラウザしか使えないため未実施）

## 静的解析

`pnpm audit` の結果: [`pnpm-audit.txt`](./pnpm-audit.txt)。4件（High2/Moderate2）検出、
いずれも開発時ツール経由で実行時コードパスに影響しないことを監査役が確認済み
（`docs/security-report.md` 参照）。gitleaks はこの環境に無く未実行。

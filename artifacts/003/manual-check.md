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

- Expo SecureStore への保存（ネイティブ実機/シミュレータでの確認。この環境では
  ブラウザしか使えないため未実施）

## 2026-08-29 追記: 実際の Google アカウントでの実機確認（M1受け入れ判定）

人間が Google Cloud Console で OAuth クライアントを作成し、`.dev.vars` を実際の値に
差し替えた後、人間の手元のブラウザ（2種類、通常ウィンドウ＋プライベートウィンドウ）で
実際に確認した。003・004 双方の導線を通しで確認している。

### 確認できたこと

1. **実際の Google アカウントでのログイン成功**（2アカウントとも成功）
2. **D1 への `user`/`account` レコード作成**を確認（ローカル `wrangler d1 execute` で実査）
   - `user` テーブルに2アカウント分のレコードが作成されている
   - `account` テーブルに `provider_id = "google"` のレコードが2アカウント分作成されている
3. **004のオンボーディング導線が実際に機能する**: `couple.create` → `invite.issue` →
   別アカウントで `invite.accept` の一連の流れが成功し、`couple_members` に
   同一 `couple_id` でスロット1・2が正しく割り当てられていることを確認した

### 実機確認で発見し、その場で修正したバグ2件

いずれも `fix/oauth-callback-and-double-submit` ブランチで修正。003完了時点の
テスト（ダミークライアントID・単一操作のみ）では踏まなかった経路。

1. **`callbackURL` が相対パスだったため、ログイン後 404 になる（ローカル開発限定）**
   `apps/app/app/(auth)/sign-in.tsx` の `signIn.social({ callbackURL: "/" })` の
   `"/"` は、Better Auth サーバー（`apps/api`、`BETTER_AUTH_URL` のオリジン）を
   起点に相対解決される。ローカル開発は `apps/app`（Expo, :8081）と
   `apps/api`（wrangler dev, :8787）が別ポートで動くため、ログイン完了後に
   `http://localhost:8787/` へリダイレクトされ、`apps/api` は `/api/*` しか
   公開していないため 404 になっていた。本番は同一 Worker から配信されるため
   この経路は顕在化しない。Web は `window.location.origin`
   （自身のオリジンへの絶対URL）を渡すよう修正した
2. **ボタンの1クリックで `sign-in/social` が2回呼ばれ、OAuthの `state` が競合する**
   `packages/ui` の `Button`（`react-native-web` の `Pressable`）が、環境によっては
   1クリックで `onPress` を2回発火させる。`signIn.social` は呼ぶたびに Better Auth
   サーバー側で新しい OAuth `state` を発行するため、2回呼ばれると1回目の `state` が
   2回目の発行で上書きされ、Google から戻ってきた時点で
   `State mismatch: State not persisted correctly`（`state_security_mismatch`）に
   なることを実機で確認した。`network requests` で実際に1クリックあたり
   `POST /api/auth/sign-in/social` が2回発生することを検証した上で、
   `apps/app/app/(auth)/sign-in.tsx` 側に再入防止のガードを追加して解決した
   （`Button`/`Pressable` 側の一般修正ではなく、認証フローという影響の大きい
   箇所にピンポイントで対応した）

これらはコードのバグであり、`docs/tasks/003-auth-google.md` の完了条件と
直接関わるため、別PRとしてレビューを依頼する
（`artifacts/fix-oauth-callback/` 参照）。

### 引き続き未確認

- ブラウザDevToolsでの Cookie 属性実地確認（`HttpOnly`/`Secure`/`SameSite=Lax`）
- ログイン → リロード → ログイン状態維持
- ログアウト → サインイン画面へ戻るUI導線

## 静的解析

`pnpm audit` の結果: [`pnpm-audit.txt`](./pnpm-audit.txt)。4件（High2/Moderate2）検出、
いずれも開発時ツール経由で実行時コードパスに影響しないことを監査役が確認済み
（`docs/security-report.md` 参照）。gitleaks はこの環境に無く未実行。

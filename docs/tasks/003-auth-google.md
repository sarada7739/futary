# 003: 認証基盤（Google OAuth）

## 目的
Better Auth + Google OAuth + D1 + Expo SecureStore の組み合わせを、
ログインからログアウトまで端から端まで通す。
このスタックで最も詰まりやすい箇所であり、早い段階で通しておく必要がある。

## 変更対象ファイル
- （新規）`apps/api/src/auth.ts` — Better Auth の初期化（D1 アダプタ、Google プロバイダ）
- `apps/api/src/index.ts` — 認証ルートのマウント
- （新規）`packages/db/schema/auth.ts` — Better Auth のテーブル定義
- （新規）`packages/db/migrations/xxxx_auth.sql`
- （新規）`apps/app/app/(auth)/sign-in.tsx` — ログイン画面
- （新規）`apps/app/lib/auth-client.ts` — クライアント側の認証、SecureStore 連携
- `packages/contract/` — `me.get` を追加

## 実装内容
- Better Auth を D1 アダプタで初期化し、Google プロバイダを設定する
- 認証テーブル（`user` / `session` / `account` / `verification`）のマイグレーションを作る
- Cookie 属性を `HttpOnly` / `Secure` / `SameSite=Lax` に設定する
- ネイティブではトークンを Expo SecureStore に保存する（`AsyncStorage` を使わない）
- `me.get` を実装する。未認証なら `null` を返す（この時点ではデモ処理はまだ無い）
- ログイン画面を作る。デザインサンプルのログイン画面を参考にする
  - 「ログイン」「新しくはじめる」「ゲストではじめる」の3ボタンを配置する
  - **この時点では「ゲストではじめる」は無効表示でよい**（014 で実装する）
- ログアウトを実装する

## セキュリティ上の必須事項
`docs/security-requirements.md` 2節に従う。
- `BETTER_AUTH_SECRET` は32バイト以上のランダム値。`.dev.vars` に置き、リポジトリに含めない
- `GOOGLE_CLIENT_SECRET` を `wrangler.toml` に直接書かない（`wrangler secret` を使う）
- 認証エラーの詳細をクライアントに返さない
- **`apps/api/src/index.ts` の CORS 設定に `credentials: true` を足す場合は、
  001から残っている開発用の `origin: ["http://localhost:8081", ...]` を
  本番ではオリジンを絞る形に見直すこと（001のRレビューで指摘。放置すると
  認証情報付きリクエストを許可オリジンが localhost 固定のまま受け付ける穴になる）**

## 人間に依頼すること
- Google Cloud Console で OAuth 2.0 クライアントIDを作成する
- 承認済みリダイレクトURIにローカル（`http://localhost:8787/api/auth/callback/google`）と
  本番のURLを登録する
- クライアントID / シークレットを受け取り、`.dev.vars` と `wrangler secret` に設定する

## 確認観点
- ログイン → リロード → ログイン状態が保たれるか
- ログアウト後に `me.get` が `null` を返すか
- Cookie 属性が意図通りか（ブラウザの開発者ツールで確認する）
- 秘密情報がリポジトリに混入していないか

## 完了条件
- [ ] Google でログインでき、ユーザーが D1 に作られる（**未検証**。人間の判断で後回し。下記「保留」参照）
- [ ] リロード後もログイン状態が保たれる（**未検証**。同上）
- [x] ログアウトできる（API単体は自動テストで確認。UI導線は実ログイン確認後）
- [x] テストが緑
- [x] **security-auditor の指摘で High 以上がゼロ**（認証を触るタスクのため必須。当初High2件検出→修正済み。`docs/security-report.md` 参照）
- [x] `artifacts/003/` に証跡を保存（スクリーンショットはブラウザペイン不可のため、ネットワークログ・テスト結果・手順記録で代替。`artifacts/003/manual-check.md` 参照）

## 保留: 実際のGoogleログイン確認

Google Cloud Console でのOAuthクライアント作成がまだの状態で実装に着手した
（`docs/state.md` の「次の一手」に事前確認事項として記載されていた）。
ダミーのクライアントID/シークレットで、OAuthフローの構築（authorization URLの組み立て、
redirect_uriの指定、CORS、Cookieの発行条件等）はコードレベル・実地の両方で確認済み。
人間に確認したところ「今は後回しでよい」との判断。人間がクライアントを作成し
`.dev.vars` を実際の値に差し替えた後、下記を追加で確認する:
- 実際のGoogleアカウントでのログイン成功、D1への `user`/`account` レコード作成
- リロード後のログイン状態維持
- ブラウザDevToolsでのCookie属性実地確認（`HttpOnly`/`Secure`/`SameSite=Lax`）
- ログアウト→サインイン画面へ戻るUI導線

## 停止条件
- 完了: 上記をすべて満たす（実ログイン確認は保留中。コード・テスト・監査は完了）
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション
- Better Auth の D1 アダプタや Expo との連携で解決不能な問題に当たった場合は、
  回避策を自作せず `state.md` に記録して A へエスカレーションする（設計判断が必要になる）

## 進捗
- [x] 人間に Google OAuth クライアントの作成を依頼した（回答: 今は後回しでよい）
- [x] Better Auth 初期化 + D1 アダプタ
- [x] 認証テーブルのマイグレーション
- [x] ログイン画面
- [x] SecureStore 連携（コード実装のみ。ネイティブ実機/シミュレータでの確認はこの環境では不可）
- [x] `me.get`
- [x] ログアウト
- [x] security-auditor 実行（High2件検出→修正、Medium一部対応、残りは`state.md`に記録）
- [x] 証跡保存 → `state.md` 更新 → `worklog.md` 追記

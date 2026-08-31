# futary

ふたり専用SNS。「ふたりの毎日を、もっと特別に。」

設計ドキュメントは [`docs/`](docs/) 以下（[`docs/state.md`](docs/state.md) が現在地）。

## 公開URL

<!--
  016（docs/tasks/016-release.md）のデプロイ完了後、実際の公開URLに書き換える。
  公開ドメイン（論点L1。docs/state.md参照）は本リリースでは `*.workers.dev` を使う。
-->

- アプリ: （デプロイ後に記載）
- デモ（ログイン不要）: （デプロイ後に記載。トップページの「デモを見る」から遷移）

## 前提

- Node.js 20 以上
- pnpm（`corepack` が使えない環境では `npm install -g pnpm`）
- Cloudflare アカウント（D1 / R2 / Workers を使うため）

## セットアップ

```bash
pnpm install
```

### Cloudflare の準備（初回のみ）

```bash
npx wrangler login
npx wrangler d1 create futary-db      # database_id が出力される
npx wrangler r2 bucket create futary-images
```

`apps/api/wrangler.toml` の `database_id` を、上のコマンドで得た値に置き換える。

### API のランタイム型を生成

`apps/api` は Cloudflare のランタイム型（`worker-configuration.d.ts`）に依存する。
`wrangler.toml` を変更したときは再生成する（`type-check` / `test` / `dev` の前に自動実行される）。

```bash
pnpm --filter @futary/api exec wrangler types
```

### ローカル D1 にマイグレーションを適用

```bash
pnpm --filter @futary/api run db:migrate:local
```

### API 側の環境変数

Google OAuth のクライアント情報・セッション署名鍵・R2 の署名用認証情報を
`.dev.vars` に置く（`.gitignore` 済みでコミットされない）。

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

各項目の取得方法は `apps/api/.dev.vars.example` のコメントを参照
（Google Cloud Console での OAuth クライアント発行、
Cloudflare ダッシュボードでの R2 API トークン発行など）。
未設定のまま起動すると `apps/api` が fail-closed で起動時エラーになる
（`docs/security-requirements.md` 参照）。

### アプリ側の環境変数

`apps/app` と `apps/api` はローカルでは別ポートで動くため、
アプリ側に API のオリジンを教える必要がある。

```bash
cp apps/app/.env.example apps/app/.env
```

## ローカル起動

2つのターミナルでそれぞれ起動する。

```bash
# 1. API（http://localhost:8787）
pnpm --filter @futary/api run dev
```

```bash
# 2. アプリ（Web版。http://localhost:8081）
pnpm --filter @futary/app run web
```

ブラウザで `http://localhost:8081` を開くとサインイン画面が表示される。
デモデータをローカルD1・R2に投入すると、「ゲストではじめる」から
ログイン不要でデモデータを閲覧できる。

```bash
pnpm --filter @futary/db run seed:local
```

## 開発コマンド

```bash
pnpm run type-check   # 型チェック（全workspace）
pnpm run lint         # ESLint
pnpm run test         # テスト（全workspace）
pnpm run db:generate  # packages/db/src/schema/ からマイグレーションSQLを生成
pnpm run build:public # ランディングページ+アプリのWeb版を1つの公開ディレクトリへ合成
```

## ディレクトリ構成

```
apps/
  app/                 # Expo Router + React Native Web（アプリ本体）
  api/                 # Cloudflare Workers（Hono + oRPC）
  landing/             # ランディングページ（素のHTML/CSS。ADR-002）
packages/
  contract/            # oRPC 手続き定義 + Zod スキーマ（型の単一の源）
  db/                  # Drizzle スキーマとマイグレーション、デモ用シード
  date/                # 日付計算ユーティリティ（決定的。乱数を使わない）
  ui/                  # 共有UIコンポーネント・デザイントークン
scripts/               # ビルド・監査補助スクリプト
docs/                  # 設計ドキュメント
artifacts/             # タスクごとの動作証跡
```

詳細は [`docs/architecture.md`](docs/architecture.md)。

## 技術構成と設計判断

- **Cloudflare Workers + D1 + R2**: アプリ（静的配信）・API（Hono）・DB・
  オブジェクトストレージを単一の Cloudflare アカウントに寄せ、個人開発の
  運用コストを最小化した
- **oRPC**: フロントエンドとAPIの間の型を単一の契約（`packages/contract`）から
  生成し、手動でのリクエスト/レスポンス型合わせを排除した
- **認可を `ctx.coupleId` に集約**: 各手続きの引数から `coupleId` を排除し、
  認証済みセッションから解決した値だけを使う設計にした。呼び出し側が
  誤って他ペアの `coupleId` を渡せる経路自体を無くしている
- **予定・記念日・会った日を1つのテーブルに統合**（`events`。ADR-009）:
  別々のテーブルで持つと「同じ日付を横断して見る」機能のたびに union が
  必要になる。統合してから種別で絞り込む設計にした
- **デモは未認証・閲覧専用**（ADR-010）: サーバ側の手続きレベルで
  書き込みを拒否する。UIでボタンを隠すことを防御の主眼にしていない
- **開発は3セッション体制**（設計・実装・レビューを分離。下記）

技術選定の背景と却下した案は [`docs/decisions.md`](docs/decisions.md)（ADR形式）に、
脅威モデルは [`docs/security-requirements.md`](docs/security-requirements.md) にまとめている。

## 開発体制

このリポジトリは Claude Code の複数セッションによる **Maker-Checker 分離**で
開発している。

| セッション | 役割 | 担当ディレクトリ |
|---|---|---|
| 設計（A） | 要件定義・タスク分割・仕様変更の判断 | `futary-A/` |
| 実装（B） | コード・テスト・動作証跡の作成 | `futary/` |
| レビュー（R） | 実装の受け入れ判定 | `futary-R/` |

git worktree でディレクトリを分離し、各セッションは自分の役割の外に書き込まない。
実装セッションは自分の実装を自己採点せず、レビューセッションの受け入れを経てから
`main` へマージする。会話履歴に依存せず、現在地・作業ログ・タスク定義を
すべてファイル（`docs/state.md`・`docs/worklog.md`・`docs/tasks/`）に置くことで、
コンテキストが失われても作業を再開できるようにしている。

運用ルールの詳細は [`docs/harness.md`](docs/harness.md)。

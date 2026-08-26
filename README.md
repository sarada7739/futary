# futary

ふたり専用SNS。「ふたりの毎日を、もっと特別に。」

設計ドキュメントは [`docs/`](docs/) 以下（[`docs/state.md`](docs/state.md) が現在地）。

## 前提

- Node.js 20 以上
- pnpm（`corepack` が使えない環境では `npm install -g pnpm`）
- Cloudflare アカウント（D1 / R2 を使うため）

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

ブラウザで `http://localhost:8081` を開き、`health.get` の結果
（`ok: true` と現在時刻）が表示されれば疎通できている。

## 開発コマンド

```bash
pnpm run type-check   # 型チェック（全workspace）
pnpm run lint         # ESLint
pnpm run test         # テスト（全workspace）
pnpm run db:generate  # packages/db/src/schema.ts からマイグレーションSQLを生成
```

## ディレクトリ構成

```
apps/
  app/                 # Expo Router + React Native Web（アプリ本体）
  api/                 # Cloudflare Workers（Hono + oRPC）
packages/
  contract/            # oRPC 手続き定義 + Zod スキーマ（型の単一の源）
  db/                  # Drizzle スキーマとマイグレーション
docs/                  # 設計ドキュメント
artifacts/             # タスクごとの動作証跡
```

詳細は [`docs/architecture.md`](docs/architecture.md)。

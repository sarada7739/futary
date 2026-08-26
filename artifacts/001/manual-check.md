# 001 歩くスケルトン: 動作確認記録

## 実施日
2026-08-26

## 手順と結果

### 1. Cloudflareリソース作成（人間が実施）
- `npx wrangler login` → 認証済み
- `npx wrangler d1 create futary-db` → `database_id: 37d32e5d-80a9-4bc9-bae4-e7019bebd883`
  → `apps/api/wrangler.toml` に反映済み
- `npx wrangler r2 bucket create futary-images` → 作成成功
  （初回は「Please enable R2 through the Cloudflare Dashboard」でエラー。
  ダッシュボードで有効化後に再実行して成功）

### 2. セットアップ
```
pnpm install
```
→ 成功。build script（esbuild, workerd）の許可は `pnpm-workspace.yaml` の
`allowBuilds` に記載して解決。

### 3. ローカルD1マイグレーション適用
```
pnpm --filter @futary/api run db:migrate:local
```
→ `0001_init.sql` が適用され `✅` で成功。

### 4. 型チェック / Lint / テスト
```
pnpm run type-check   # 全workspace Done（エラーなし）
pnpm run lint         # eslint . エラーなし
pnpm run test         # apps/api: 1 passed (1)
```
詳細ログ: `ci-local-run.log`

`apps/api` のテスト（`test/health.test.ts`）は `@cloudflare/vitest-plugin` で
Miniflare上のD1に対して実際に `health.get` を呼び出し、
`ok: true` と現在時刻が返ることを確認している。

### 5. API単体起動確認
```
cd apps/api && npx wrangler dev --port 8787
```
→ 起動ログ: `wrangler-dev.log`
→ `POST /api/health/get` に対して
  `{"json":{"ok":true,"now":1787767574697}}` （200 OK）を確認。
  ログに `env.DB (futary-db) D1 Database local` の疎通表示あり。

### 6. アプリ起動・画面確認（Web）
```
cp apps/app/.env.example apps/app/.env
cd apps/app && pnpm run web
```
→ Metro バンドル成功。ブラウザ（Claude Browser経由、http://localhost:8081）で確認。

画面表示内容（`get_page_text` で取得したテキスト）:
```
futary
ok: true
now: 2026-08-26T18:12:05.455Z
```

D1への疎通結果がAPI経由でフロントエンドまで表示されることを確認した。

### 7. GitHub Actions
PR #1（https://github.com/sarada7739/futary/pull/1）で CI が `success`。
ログ: `github-actions-ci.log`

## 途中でハマった点（メモ）
- `@orpc/server` の `RouterClient<T>` は実装ルーター用の型。契約(`contract`)から
  クライアント型を作る場合は `@orpc/contract` の `ContractRouterClient<T>` を使う。
- `wrangler d1 migrations apply` を実行するために `wrangler.toml` の `database_id` が必要。
  `@cloudflare/workers-types` は非推奨方向で、`wrangler types` が生成する
  `worker-configuration.d.ts`（gitignore対象）に統一した。
- `@cloudflare/vitest-pool-workers` は現行バージョンで `./config` エクスポートが無く、
  `defineWorkersConfig` は使えない。後継の `@cloudflare/vitest-plugin`
  （`cloudflareTest` プラグイン）に置き換えた。
- Expo SDK 57 の Web ビルドには `@expo/metro-runtime` に加えて
  Metro の `disableHierarchicalLookup` を無効にする必要があった
  （pnpmのsymlink構造下では依存の依存が解決できなくなるため）。
- 開発時、`apps/app`（Expo, 8081）と `apps/api`（wrangler dev, 8787）は別ポートで
  動くため `window.location.origin` を使うと自分自身を叩いてしまう。
  `EXPO_PUBLIC_API_ORIGIN` で明示指定するようにした（本番は同一オリジン配信のため不要）。

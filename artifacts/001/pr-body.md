## 概要
docs/tasks/001-walking-skeleton.md の実装。

- pnpm workspace 構成
- `packages/contract`: `health.get`（戻り値 `{ ok: true, now: number }`）
- `apps/api`: Hono + oRPC。`/api/*` で公開。D1に対して `SELECT 1` を実行して疎通確認
- `apps/app`: Expo Router + TanStack Query。`health.get` の結果を画面表示
- `packages/db`: Drizzle + drizzle-kit のマイグレーション基盤（空マイグレーション1本）
- GitHub Actions: 型チェック → Lint → テスト

## 動作確認
- `pnpm run type-check` / `pnpm run lint` / `pnpm run test` すべて緑
- ローカルD1へのマイグレーション適用を確認
- `wrangler dev` でAPIを起動し `/api/health/get` が `{"json":{"ok":true,"now":...}}` を返すことを確認
- Expo Web（`pnpm --filter @futary/app run web`）を起動し、ブラウザで `ok: true` と現在時刻の表示を確認

証跡は `artifacts/001/` を参照。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

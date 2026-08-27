export interface RpcContext {
  db: D1Database;
  user: { id: string; name: string; email: string; image: string | null } | null;
  // レート制限用。Cloudflare が付与する CF-Connecting-IP。ローカル開発等で
  // 取得できない場合は null（invite.accept のレート制限は IP 条件を外し、
  // user_id 単独で判定する。apps/api/src/procedures/couple.ts の
  // reserveInviteFailureSlot を参照。R-23: このコメントが古いままだった）
  ip: string | null;
  // デモペアの couple_id（wrangler.toml の [vars]）。014 でデモペアを作るまでは
  // 空文字。未認証アクセスの couple_id 解決に使う
  // （apps/api/src/middleware/auth-context.ts）。未設定・空文字なら fail-closed
  // で未認証アクセスそのものを拒否する（docs/tasks/005-authorization-middleware.md）
  demoCoupleId: string | null;
}

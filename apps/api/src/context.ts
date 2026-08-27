export interface RpcContext {
  db: D1Database;
  user: { id: string; name: string; email: string; image: string | null } | null;
  // レート制限用。Cloudflare が付与する CF-Connecting-IP。ローカル開発等で
  // 取得できない場合は null（同一バケットに丸められる）
  ip: string | null;
}

import type { R2SignConfig } from "./lib/r2-signed-url";

export interface RpcContext {
  db: D1Database;
  // 画像本体は Worker を経由しない。post.uploadUrl/post.list が
  // 署名付きURLを発行するためだけに使う（apps/api/src/lib/r2-signed-url.ts）
  bucket: R2Bucket;
  r2Sign: R2SignConfig;
  user: { id: string; name: string; email: string; image: string | null } | null;
  // me.delete の再認証チェック（024・Aの決定）に使う、実際にサインインした
  // 時刻。Better Auth の session.createdAt は createSession() 時に一度だけ
  // 設定され、以後更新されない（session.updatedAt/expiresAt は定期リフレッシュ
  // 〈updateAge〉で動くため使えない。node_modules内のBetter Auth本体のソースを
  // 読んで確認済み）。userがnullなら常にnull。エポックミリ秒で持つ
  // （Dateのままだとnew Date(...)禁止のeslintルールに抵触するファイルが
  // 増える。architecture.md 5節・eslint.config.js）
  sessionCreatedAt: number | null;
  // invite.accept のレート制限キー（invite_failures.account_hash）を
  // 組み立てるためだけに使う塩（lib/account-hash.ts）。BETTER_AUTH_SECRETと
  // 同じ値だが、createAuth()が既に検証済み（32バイト以上）であることを
  // 前提にできるのはこのミドルウェアの中だけなので、ここでは検証し直さず
  // そのまま渡す
  authSecret: string;
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

import type { R2SignConfig } from "./lib/r2-signed-url";
import type { AiEnv } from "./lib/ai";
import type { BillingContext } from "./lib/billing";

export interface RpcContext {
  db: D1Database;
  // 画像本体は Worker を経由しない。署名付き URL を発行するためだけに使う（lib/r2-signed-url.ts）
  bucket: R2Bucket;
  r2Sign: R2SignConfig;
  // 手続きはこれを lib/ai.ts へ渡すだけで中身を見ない（プロバイダが手続きから見えない。037）
  aiEnv: AiEnv;
  // Stripe の窓口と Price ID（lib/billing.ts）。optional なのは、Stripe を使わない手続きのテストが
  // context を手で組むから。無いまま billing.* を呼ぶと 500（黙って free にしない）
  billing?: BillingContext;
  // 運営のメール（小文字化・trim 済み）。判定は middleware/auth-context.ts の resolveIsAdmin の 1 箇所。
  // 無ければ運営はいない（fail-closed）
  adminEmails?: readonly string[];
  // 天気・祝日の外部 fetch（テストが差し替える）。無ければ global の fetch
  externalFetch?: (input: string, init: RequestInit) => Promise<Response>;
  user: { id: string; name: string; email: string; image: string | null } | null;
  // 実際にサインインした時刻（me.delete の再認証に使う。024）。session.createdAt は作成時に
  // 一度だけ設定される（updatedAt・expiresAt はリフレッシュで動くので使えない）。
  // user が null なら null。Date でなくエポックミリ秒で持つ（new Date 禁止の eslint ルール。architecture.md 5節）
  sessionCreatedAt: number | null;
  // invite.accept のレート制限キーを作る塩（lib/account-hash.ts）。BETTER_AUTH_SECRET と同じ値で、
  // createAuth() が検証済み（32 バイト以上）なので検証し直さない
  authSecret: string;
  // CF-Connecting-IP。取れなければ null（invite.accept は account_hash だけで判定する）
  ip: string | null;
  // デモペアの couple_id（[vars]）。未認証アクセスの couple_id 解決に使う（middleware/auth-context.ts）。
  // 未設定・空文字なら未認証アクセスを拒む（fail-closed）
  demoCoupleId: string | null;
}

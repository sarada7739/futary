import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { expo } from "@better-auth/expo";
import { createDb, schema } from "@futary/db";
import type { Bindings } from "./index";

/**
 * Cloudflare Workers はリクエストごとに env(bindings) が変わるため、
 * Better Auth のインスタンスもリクエストごとに作る。
 *
 * secret が未設定・短すぎる場合、Better Auth は公開済みのデフォルト鍵に
 * フォールバックする（本番判定は NODE_ENV に依存するが Workers では設定していない）。
 * 誰でも署名可能な鍵でセッションが発行される事態を防ぐため、ここで fail-fast する
 * （security-auditor 003監査 High指摘）。
 */
function assertValidSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET が未設定か短すぎます（32バイト以上必須）。.dev.vars / wrangler secret を確認してください",
    );
  }
}

function assertBaseUrl(url: string | undefined): asserts url is string {
  if (!url) {
    throw new Error(
      "BETTER_AUTH_URL が未設定です。.dev.vars / wrangler secret を確認してください",
    );
  }
}

export function createAuth(env: Bindings) {
  assertValidSecret(env.BETTER_AUTH_SECRET);
  assertBaseUrl(env.BETTER_AUTH_URL);
  const db = createDb(env.DB);
  const isHttps = env.BETTER_AUTH_URL.startsWith("https://");

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
      // D1 はインタラクティブなトランザクションを持たないため無効化する
      transaction: false,
    }),
    // Web (Expo Web) とネイティブ (カスタムスキーム) の双方からのコールバックを許可する
    trustedOrigins: env.TRUSTED_ORIGINS?.split(",").filter(Boolean) ?? [],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [expo()],
    advanced: {
      // baseURL の綴り(http/https)だけに暗黙で依存させず、意図を明示する。
      // ローカル(http)では意図的に false、本番(https)では true
      useSecureCookies: isHttps,
    },
    rateLimit: {
      // OAuth系エンドポイントへの基本的な連打対策。招待コード用の本格的なレート制限
      // （IP単位・database storage）は招待機能タスクで rateLimit テーブルとあわせて実装する
      enabled: true,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

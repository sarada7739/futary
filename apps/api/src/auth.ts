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

// localhost / 127.0.0.1 / [::1] のみ http を許す。それ以外のホストに http を使うと
// Cookie の Secure 属性が落ちる（＝本番でこの形になってはならない）。
// 環境変数（NODE_ENV等）で分岐させず、ホスト名で判定する。環境変数分岐は
// 本番に開発用の値が設定された場合に検証をすり抜けるため（architecture.md 8節）
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function assertAllowedUrl(label: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} の形式が不正です（${value}）`);
  }
  if (url.protocol === "http:" && !LOCAL_HOSTNAMES.has(url.hostname)) {
    throw new Error(
      `${label} が http です（${value}）。localhost 以外では https 必須です`,
    );
  }
  // TRUSTED_ORIGINS は Better Auth の trustedOrigins にもそのまま渡され、
  // ワイルドカードマッチ（*.example.com 等）に使われる。*.pages.dev / *.workers.dev
  // のような Cloudflare の共有ドメインを誤って許可すると、他人のデプロイ先が
  // OAuth ログイン後のリダイレクト先として信頼されてしまう。ワイルドカード自体を
  // 明示的に禁止し、完全一致のオリジンのみ許可する
  // （security-auditor 実機確認バグ修正 Low指摘）
  if (url.hostname.includes("*") || url.hostname.includes("?")) {
    throw new Error(
      `${label} にワイルドカードは使用できません（${value}）。完全一致のオリジンを指定してください`,
    );
  }
}

function assertBaseUrl(url: string | undefined): asserts url is string {
  if (!url) {
    throw new Error(
      "BETTER_AUTH_URL が未設定です。.dev.vars / wrangler secret を確認してください",
    );
  }
  assertAllowedUrl("BETTER_AUTH_URL", url);
}

export function parseTrustedOrigins(value: string | undefined): string[] {
  const origins = value?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
  for (const origin of origins) {
    assertAllowedUrl("TRUSTED_ORIGINS", origin);
  }
  return origins;
}

export function createAuth(env: Bindings) {
  assertValidSecret(env.BETTER_AUTH_SECRET);
  assertBaseUrl(env.BETTER_AUTH_URL);
  const trustedOrigins = parseTrustedOrigins(env.TRUSTED_ORIGINS);
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
    trustedOrigins,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [expo()],
    advanced: {
      // assertBaseUrl により、この時点で isHttps が false なのは
      // localhost/127.0.0.1 のときだけに限定されている（本番相当のホストで
      // http のまま Secure Cookie が落ちる、という経路は起動時エラーで塞がれている）
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

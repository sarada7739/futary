import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { expo } from "@better-auth/expo";
import { createDb, schema } from "@futary/db";
import type { Bindings } from "./index";

/**
 * Workers は env がリクエストごとなので、Better Auth のインスタンスもリクエストごとに作る。
 *
 * secret が未設定・短すぎると Better Auth は公開済みの既定の鍵に落ちる（本番判定の NODE_ENV は
 * Workers で設定していない）。誰でも署名できる鍵でセッションを出さないよう fail-fast する。
 */
function assertValidSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET が未設定か短すぎます（32バイト以上必須）。.dev.vars / wrangler secret を確認してください",
    );
  }
}

// http を許すのは localhost・127.0.0.1・[::1] だけ（他のホストで http だと Cookie の Secure が落ちる）。
// 環境変数でなくホスト名で判定する（本番に開発用の値が入ったときにすり抜けないように。architecture.md 8節）
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
  // この値は Better Auth の trustedOrigins にも渡り、ワイルドカードに使われる。*.workers.dev のような
  // 共有ドメインを許すと他人のデプロイ先がログイン後のリダイレクト先として信頼されるので、
  // ワイルドカード自体を禁じて完全一致だけ許す
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
    // Web（Expo Web）とネイティブ（カスタムスキーム）の両方からのコールバックを許す
    trustedOrigins,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [expo()],
    advanced: {
      // assertBaseUrl があるので、ここで isHttps が false なのは localhost・127.0.0.1 のときだけ
      useSecureCookies: isHttps,
      ipAddress: {
        // 既定は x-forwarded-for を見るが、利用者の送った値に Cloudflare が実 IP を足して 2 要素になり、
        // IP を解決できず共有のバケットに丸められる（無関係な利用者を巻き込んだ 429）。
        // cf-connecting-ip は実 IP を 1 つだけ持つ
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    rateLimit: {
      // OAuth のエンドポイントへの基本的な連打対策（招待コードのレート制限は invite_failures で別に持つ）
      enabled: true,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { createAuth, parseTrustedOrigins } from "../src/auth";
import type { Bindings } from "../src/index";

const baseEnv = env as unknown as Bindings;

// High指摘2件の修正（fail-fast）が回帰しても気づけるようにするテスト
// （R-18: レビュー指摘）
describe("createAuth の fail-fast 検証", () => {
  it("BETTER_AUTH_SECRET が未設定なら例外を投げる", () => {
    expect(() => createAuth({ ...baseEnv, BETTER_AUTH_SECRET: undefined })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("BETTER_AUTH_SECRET が32文字未満なら例外を投げる", () => {
    expect(() => createAuth({ ...baseEnv, BETTER_AUTH_SECRET: "short-secret" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("BETTER_AUTH_URL が未設定なら例外を投げる", () => {
    expect(() => createAuth({ ...baseEnv, BETTER_AUTH_URL: undefined })).toThrow(
      /BETTER_AUTH_URL/,
    );
  });

  it("BETTER_AUTH_URL が http かつ localhost/127.0.0.1 以外なら例外を投げる", () => {
    expect(() =>
      createAuth({ ...baseEnv, BETTER_AUTH_URL: "http://futary.example.com" }),
    ).toThrow(/https 必須/);
  });

  it("BETTER_AUTH_URL が http://localhost なら許可される", () => {
    expect(() =>
      createAuth({ ...baseEnv, BETTER_AUTH_URL: "http://localhost:8787" }),
    ).not.toThrow();
  });

  it("BETTER_AUTH_URL が http://127.0.0.1 なら許可される", () => {
    expect(() =>
      createAuth({ ...baseEnv, BETTER_AUTH_URL: "http://127.0.0.1:8787" }),
    ).not.toThrow();
  });

  it("BETTER_AUTH_URL が https なら許可される", () => {
    expect(() =>
      createAuth({ ...baseEnv, BETTER_AUTH_URL: "https://futary.example.com" }),
    ).not.toThrow();
  });

  it("BETTER_AUTH_URL が http://[::1] なら許可される", () => {
    expect(() =>
      createAuth({ ...baseEnv, BETTER_AUTH_URL: "http://[::1]:8787" }),
    ).not.toThrow();
  });
});

// architecture.md 8節: TRUSTED_ORIGINS にも BETTER_AUTH_URL と同じホスト名検証を適用する
describe("parseTrustedOrigins の検証", () => {
  it("localhost / 127.0.0.1 / [::1] の http は許可される", () => {
    expect(() =>
      parseTrustedOrigins("http://localhost:8081,http://127.0.0.1:8081,http://[::1]:8081"),
    ).not.toThrow();
  });

  it("https のオリジンはホストを問わず許可される", () => {
    expect(() => parseTrustedOrigins("https://futary.example.com")).not.toThrow();
  });

  it("localhost 以外への http が含まれると例外を投げる", () => {
    expect(() => parseTrustedOrigins("http://evil.example.com")).toThrow(/https 必須/);
  });

  it("未設定なら空配列を返す（例外にしない。CORSがfail-closedになるだけ）", () => {
    expect(parseTrustedOrigins(undefined)).toEqual([]);
  });

  it("不正な形式の値は例外を投げる", () => {
    expect(() => parseTrustedOrigins("not-a-url")).toThrow(/形式が不正/);
  });

  // TRUSTED_ORIGINS は Better Auth の trustedOrigins（ワイルドカードマッチ対応）に
  // そのまま渡るため、*.pages.dev のような Cloudflare の共有ドメインを誤って
  // 許可すると、他人のデプロイ先が OAuth ログイン後のリダイレクト先として
  // 信頼されてしまう（実機ログイン確認バグ修正時のsecurity-auditor Low指摘）
  it("ワイルドカードを含むホスト名は例外を投げる", () => {
    expect(() => parseTrustedOrigins("https://*.pages.dev")).toThrow(/ワイルドカード/);
  });
});

// T8（想定脅威。security-requirements.md 9節）の担保は auth.ts の
// useSecureCookies 指定とBetter Authの既定値の組み合わせに依存しており、
// 依存側の既定値が変わってもテストが検知できなかった（security-auditor
// 全体監査Low-5指摘）。実際にCookieを発行するエンドポイントを叩き、
// 属性を直接検証する
describe("セッションCookieの属性（T8: セッション奪取対策）", () => {
  it("http（localhost）ではSecure属性が付かない。HttpOnly・SameSite=Laxは付く", async () => {
    const response = await app.fetch(
      new Request("http://localhost/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:8081" },
        body: JSON.stringify({ provider: "google", callbackURL: "http://localhost:8081" }),
      }),
      { ...env, BETTER_AUTH_URL: "http://localhost:8787", TRUSTED_ORIGINS: "http://localhost:8081" } as unknown as Bindings,
    );

    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).not.toMatch(/Secure/i);
    }
  });

  it("https（本番相当）ではSecure属性も付く", async () => {
    const response = await app.fetch(
      new Request("https://futary.example.com/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://futary.example.com" },
        body: JSON.stringify({ provider: "google", callbackURL: "https://futary.example.com" }),
      }),
      {
        ...env,
        BETTER_AUTH_URL: "https://futary.example.com",
        TRUSTED_ORIGINS: "https://futary.example.com",
      } as unknown as Bindings,
    );

    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Secure/i);
    }
  });
});

import { env } from "cloudflare:test";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { describe, expect, it } from "vitest";
import type { Contract } from "@futary/contract";
import type { ContractRouterClient } from "@orpc/contract";
import app from "../src/index";
import type { Bindings } from "../src/index";

function createTestClient(): ContractRouterClient<Contract> {
  const link = new RPCLink({
    url: "http://localhost/api",
    fetch: async (request, init) =>
      app.fetch(new Request(request, init), env as unknown as Bindings),
  });
  return createORPCClient(link);
}

describe("me.get", () => {
  it("未認証なら null を返す", async () => {
    const client = createTestClient();

    const result = await client.me.get();

    expect(result).toBeNull();
  });
});

describe("/api/auth/*", () => {
  it("Better Auth のセッション確認エンドポイントに到達できる（未認証）", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/get-session"),
      env as unknown as Bindings,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("sign-out はセッションが無くてもエラーにならない", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/sign-out", { method: "POST" }),
      env as unknown as Bindings,
    );

    expect(res.status).toBeLessThan(500);
  });

  it("expo-authorization-proxy は塞がれている（オープンリダイレクト対策）", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/expo-authorization-proxy"),
      env as unknown as Bindings,
    );

    expect(res.status).toBe(404);
  });
});

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

describe("health.get", () => {
  it("D1への疎通が確認でき、ok: true と現在時刻を返す", async () => {
    const client = createTestClient();
    const before = Date.now();

    const result = await client.health.get();

    expect(result.ok).toBe(true);
    expect(result.now).toBeGreaterThanOrEqual(before);
  });
});

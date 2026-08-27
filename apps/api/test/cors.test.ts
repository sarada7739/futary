import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Bindings } from "../src/index";

const bindings = env as unknown as Bindings;

// CORS の fail-closed 挙動（credentials: true と組み合わせた許可オリジンの絞り込み）
// が回帰しても気づけるようにするテスト（R-18: レビュー指摘）
describe("CORS の fail-closed 検証", () => {
  it("TRUSTED_ORIGINS に含まれるオリジンには Access-Control-Allow-Origin が返る", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/get-session", {
        headers: { Origin: "http://localhost:8081" },
      }),
      bindings,
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8081");
  });

  it("TRUSTED_ORIGINS に含まれないオリジンには Access-Control-Allow-Origin が返らない", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/get-session", {
        headers: { Origin: "http://evil.example.com" },
      }),
      bindings,
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("TRUSTED_ORIGINS が未設定なら、許可されうるオリジンでも ACAO を返さない（fail-closed）", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/get-session", {
        headers: { Origin: "http://localhost:8081" },
      }),
      { ...bindings, TRUSTED_ORIGINS: undefined },
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

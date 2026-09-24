import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Bindings } from "../src/index";

const bindings = env as unknown as Bindings;

// CORS の fail-closed（credentials: true と組み合わせた許可オリジンの絞り込み）が回帰しても気づけるようにする
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

  // 本番の TRUSTED_ORIGINS は https://nisoine.com だけ（旧ホストは 301 するので要らない）。新オリジンからの
  // API は通り、旧オリジンからは ACAO が返らない（053 T6）
  it("053 T6: TRUSTED_ORIGINS=https://nisoine.com だけで、新オリジンには ACAO が返り旧オリジンには返らない", async () => {
    const withCanonical = { ...bindings, TRUSTED_ORIGINS: "https://nisoine.com" };

    const fromCanonical = await app.fetch(
      new Request("https://nisoine.com/api/auth/get-session", {
        headers: { Origin: "https://nisoine.com" },
      }),
      withCanonical,
    );
    expect(fromCanonical.status).toBe(200);
    expect(fromCanonical.headers.get("Access-Control-Allow-Origin")).toBe("https://nisoine.com");

    const fromLegacy = await app.fetch(
      new Request("https://nisoine.com/api/auth/get-session", {
        headers: { Origin: "https://futary-api.sarada7739.workers.dev" },
      }),
      withCanonical,
    );
    expect(fromLegacy.headers.get("Access-Control-Allow-Origin")).toBeNull();
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

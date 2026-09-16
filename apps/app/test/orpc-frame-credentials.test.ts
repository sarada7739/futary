import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 056 T3b: 框の中（window.top !== window.self）では API クライアント（lib/orpc.ts）の fetch に Cookie が付かない
// （credentials: "omit"）。框の外は今まで通り "include"。本物の lib/orpc.ts を読み、global の fetch だけ差し替える。
// Better Auth のクライアント（lib/auth-client.ts）も同じ frameCredentials() を customFetchImpl に渡している
// （expo-secure-store が jsdom で読めないので、こちらは demo-frame.test.tsx の frameCredentials の検査と
// artifacts/056/capture.json〈ログイン中の框の get-session に Cookie 無し〉で見る）

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ json: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } }));
const originalFetch = globalThis.fetch;
const originalTop = Object.getOwnPropertyDescriptor(window, "top");

beforeEach(() => {
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTop) Object.defineProperty(window, "top", originalTop);
});

const { client } = await import("../lib/orpc");

function credentialsOfLastCall(): RequestCredentials | undefined {
  const [input, init] = fetchMock.mock.calls.at(-1) as unknown as [RequestInfo, RequestInit | undefined];
  if (init?.credentials) return init.credentials;
  return input instanceof Request ? input.credentials : undefined;
}

describe("056 T3b: lib/orpc.ts の fetch の credentials", () => {
  it("框の外: include（Cookie を送る）", async () => {
    await client.couple.get().catch(() => {});
    expect(fetchMock).toHaveBeenCalled();
    expect(credentialsOfLastCall()).toBe("include");
  });

  it("框の中: omit（ログイン中でも Cookie を送らない = サーバから見て未認証 = デモペア）", async () => {
    Object.defineProperty(window, "top", { configurable: true, get: () => ({}) });
    await client.couple.get().catch(() => {});
    expect(fetchMock).toHaveBeenCalled();
    expect(credentialsOfLastCall()).toBe("omit");
  });
});

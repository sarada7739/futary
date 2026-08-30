import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 020: 013のMemoryCardをホームから独立したページへ移した。カード自体の挙動
// （ラベル・画像タップ・本文展開等）はmemory-card.test.tsxで検証済みのため、
// ここではページがMemoryCardを表示することだけを確認する（薄いラッパーの
// ためのテストを厚くしない）
const { memoryGetMock } = vi.hoisted(() => ({
  memoryGetMock: vi.fn(),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { memory: { get: memoryGetMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: MemoryScreen } = await import("../app/memory");
const { queryClient } = await import("../lib/query");

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

describe("MemoryScreen", () => {
  it("MemoryCardの内容を表示する", async () => {
    memoryGetMock.mockResolvedValue({
      post: {
        id: "post-1",
        body: "初めて一緒に海を見に行った日",
        imageUrl: null,
        imageWidth: null,
        imageHeight: null,
        createdAt: Math.floor(Date.now() / 1000),
      },
      label: "oneYearAgo",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("初めて一緒に海を見に行った日")).toBeTruthy();
  });
});

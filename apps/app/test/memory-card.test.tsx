import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 013: 思い出しカードの画面結合テスト。stats-card.test.tsx と同じ形で
// oRPC クライアントをモックする
const { memoryGetMock } = vi.hoisted(() => ({
  memoryGetMock: vi.fn(),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { memory: { get: memoryGetMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { MemoryCard } = await import("../components/memory-card");
const { queryClient } = await import("../lib/query");

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

function renderCard() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryCard />
    </QueryClientProvider>,
  );
}

function makeResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    post: {
      id: "post-1",
      body: "初めて一緒に海を見に行った日",
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      createdAt: Math.floor(Date.UTC(2026, 5, 15, 3, 0, 0) / 1000), // JST 2026-06-15 12:00
    },
    label: "oneMonthAgo",
    ...overrides,
  };
}

describe("MemoryCard", () => {
  it("ラベル・日付・本文を表示する", async () => {
    memoryGetMock.mockResolvedValue(makeResult());

    renderCard();

    expect(await screen.findByText("1ヶ月前の今日")).toBeTruthy();
    expect(screen.getByText("2026/6/15")).toBeTruthy();
    expect(screen.getByText("初めて一緒に海を見に行った日")).toBeTruthy();
  });

  it("ラベルごとに文言が変わる", async () => {
    memoryGetMock.mockResolvedValue(makeResult({ label: "random" }));

    renderCard();

    expect(await screen.findByText("あの日の思い出")).toBeTruthy();
  });

  it("画像があるとタップで全画面表示が開く", async () => {
    memoryGetMock.mockResolvedValue(
      makeResult({
        post: { ...makeResult().post, imageUrl: "https://example.com/memory.jpg" },
      }),
    );

    renderCard();
    const image = await screen.findByLabelText("思い出の投稿を表示");
    fireEvent.click(image);

    expect(await screen.findByTestId("image-viewer-image")).toBeTruthy();
  });

  // Aが013の仕様に追加した挙動（PR #101。Rレビューでも同じ穴を指摘された）:
  // テキストのみの思い出（画像を優先しない探索4段目のランダム選択で起こりうる）
  // には画像側のタップ先が無く、本文を最後まで読む手段が無くなる穴があった。
  // 本文タップでの展開/折りたたみで塞いだ
  it("本文をタップすると展開/折りたたみが切り替わる（画像が無い思い出でも読み返せる）", async () => {
    memoryGetMock.mockResolvedValue(makeResult({ post: { ...makeResult().post, imageUrl: null } }));

    renderCard();
    const body = await screen.findByLabelText("本文をすべて表示");

    fireEvent.click(body);
    expect(await screen.findByLabelText("本文を折りたたむ")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("本文を折りたたむ"));
    expect(await screen.findByLabelText("本文をすべて表示")).toBeTruthy();
  });

  it("nullが返るとカード自体を表示しない（該当なし）", async () => {
    memoryGetMock.mockResolvedValue(null);

    const { container } = renderCard();

    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it(
    "通信エラー時もカード自体を表示しない",
    async () => {
      memoryGetMock.mockRejectedValue(new Error("network"));

      const { container } = renderCard();

      await waitFor(() => expect(container.textContent).toBe(""), { timeout: 10000 });
    },
    15000,
  );
});

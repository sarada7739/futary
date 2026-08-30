import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 012: 統計カードの画面結合テスト。home-timeline.test.tsx と同じ形で
// oRPC クライアントをモックする
const { statsGetMock } = vi.hoisted(() => ({
  statsGetMock: vi.fn(),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { stats: { get: statsGetMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { StatsCard } = await import("../components/stats-card");
const { queryClient } = await import("../lib/query");

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

function renderCard() {
  return render(
    <QueryClientProvider client={queryClient}>
      <StatsCard />
    </QueryClientProvider>,
  );
}

describe("StatsCard", () => {
  it("記念日が今日以前なら「付き合って○日目」を表示する", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "together", days: 365 },
      meetupDays: 48,
      postCount: 10,
      photoCount: 5,
      members: [
        { userId: "u1", name: "Haruka", image: null },
        { userId: "u2", name: "Yuki", image: null },
      ],
    });

    renderCard();

    expect(await screen.findByText("付き合って 365日目")).toBeTruthy();
    expect(screen.getByText("会った日数：48日")).toBeTruthy();
    expect(screen.getByText("Haruka")).toBeTruthy();
    expect(screen.getByText("Yuki")).toBeTruthy();
    expect(screen.queryByText("招待中")).toBeNull();
  });

  it("記念日が未来なら「あと○日」を表示する（負の値を出さない）", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "upcoming", days: 5 },
      meetupDays: 0,
      postCount: 0,
      photoCount: 0,
      members: [{ userId: "u1", name: "Haruka", image: null }],
    });

    renderCard();

    expect(await screen.findByText("記念日まで あと5日")).toBeTruthy();
    expect(screen.queryByText(/-/)).toBeNull();
  });

  it("会った日ゼロでも「会った日数：0日」が出て、カード自体は表示される", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "together", days: 1 },
      meetupDays: 0,
      postCount: 0,
      photoCount: 0,
      members: [{ userId: "u1", name: "Haruka", image: null }],
    });

    renderCard();

    expect(await screen.findByText("会った日数：0日")).toBeTruthy();
  });

  it("ペアが1人だけなら、相手の枠に「招待中」が出る", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "together", days: 1 },
      meetupDays: 0,
      postCount: 0,
      photoCount: 0,
      members: [{ userId: "u1", name: "Haruka", image: null }],
    });

    renderCard();

    expect(await screen.findByText("招待中")).toBeTruthy();
  });

  it(
    "通信エラー時はカード自体を表示しない",
    async () => {
      statsGetMock.mockRejectedValue(new Error("network"));

      const { container } = renderCard();

      // 既定のリトライ（3回・指数バックオフ）が尽きるまでisErrorにならないため
      // 通常より長いタイムアウトを与える（011のcalendar-screen.test.tsxと同じ理由）
      await waitFor(() => expect(container.textContent).toBe(""), { timeout: 10000 });
    },
    15000,
  );
});

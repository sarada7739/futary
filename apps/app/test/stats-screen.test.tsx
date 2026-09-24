import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 統計の 4 つの数字をホームから独立したページで出す（020）。primary_date='none'（hidden）のときは
// 記念日の行を出さず 3 つ
const { statsGetMock, pushMock } = vi.hoisted(() => ({
  statsGetMock: vi.fn(),
  pushMock: vi.fn(),
}));

// unset のときマイページへ遷移する useRouter をモックする
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { stats: { get: statsGetMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

// useViewerQueryKey が auth-client 経由で useSession を参照するのでモックする
vi.mock("../lib/auth-client", () => ({
  useSession: () => ({ data: null }),
}));

const { default: StatsScreen } = await import("../app/(tabs)/stats");
const { queryClient } = await import("../lib/query");

function makeStats(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    daysTogether: { status: "dating", days: 1 },
    meetupDays: 0,
    postCount: 0,
    photoCount: 0,
    members: [{ userId: "u1", name: "自分", image: null }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

function renderScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <StatsScreen />
    </QueryClientProvider>,
  );
}

describe("StatsScreen", () => {
  it("primary_date='dating'なら4つ（記念日・会った日数・投稿数・写真の枚数）出る", async () => {
    statsGetMock.mockResolvedValue(
      makeStats({
        daysTogether: { status: "dating", days: 365 },
        meetupDays: 12,
        postCount: 40,
        photoCount: 25,
      }),
    );

    renderScreen();

    expect(await screen.findByText("付き合って 365日目")).toBeTruthy();
    expect(screen.getByText("12日")).toBeTruthy();
    expect(screen.getByText("40件")).toBeTruthy();
    expect(screen.getByText("25枚")).toBeTruthy();
  });

  it("primary_date='married'なら「結婚して○日目」で出る", async () => {
    statsGetMock.mockResolvedValue(makeStats({ daysTogether: { status: "married", days: 100 } }));

    renderScreen();

    expect(await screen.findByText("結婚して 100日目")).toBeTruthy();
  });

  // hidden のときは記念日の行だけ出さず 3 つ（stats.get が days を返さない）
  it("primary_date='none'（hidden）なら記念日の行を出さず3つになる", async () => {
    statsGetMock.mockResolvedValue(
      makeStats({ daysTogether: { status: "hidden" }, meetupDays: 5, postCount: 10, photoCount: 3 }),
    );

    renderScreen();

    await screen.findByText("5日");
    expect(screen.getByText("10件")).toBeTruthy();
    expect(screen.getByText("3枚")).toBeTruthy();
    expect(screen.queryByText(/付き合って/)).toBeNull();
    expect(screen.queryByText(/結婚して/)).toBeNull();
    expect(screen.queryByText("記念日")).toBeNull();
    // hiddenは本人が隠すと決めたので、マイページへの導線は出さない（023）
    expect(screen.queryByText("付き合った日を設定する")).toBeNull();
  });

  // unset（まだ決めていない）は hidden と違い、記念日の行を出さず 3 つ＋マイページへの導線（023）
  it("daysTogetherが'unset'なら記念日の行を出さず、マイページへの導線が出る", async () => {
    statsGetMock.mockResolvedValue(
      makeStats({ daysTogether: { status: "unset" }, meetupDays: 5, postCount: 10, photoCount: 3 }),
    );

    renderScreen();

    const link = await screen.findByText("付き合った日を設定する");
    expect(screen.getByText("10件")).toBeTruthy();
    expect(screen.queryByText("記念日")).toBeNull();

    fireEvent.click(link);
    expect(pushMock).toHaveBeenCalledWith("/profile");
  });

  it(
    "通信エラー時はエラーメッセージを表示する",
    async () => {
      statsGetMock.mockRejectedValue(new Error("network"));

      renderScreen();

      // 既定のリトライ（3 回・指数バックオフ）が尽きるまで isError にならないので長めに待つ
      expect(
        await screen.findByText("統計を読み込めませんでした", {}, { timeout: 10000 }),
      ).toBeTruthy();
    },
    15000,
  );
});

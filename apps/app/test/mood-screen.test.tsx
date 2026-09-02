import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 029: 気分の記録画面の結合テスト。list-screen.test.tsxと同じ形でoRPCクライアントをモックする
const { listMock, setTodayMock, clearTodayMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  setTodayMock: vi.fn(),
  clearTodayMock: vi.fn(),
}));

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "me", name: "自分", email: "me@example.com", image: null } },
    isPending: false,
  }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    mood: {
      list: listMock,
      setToday: setTodayMock,
      clearToday: clearTodayMock,
    },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: MoodScreen } = await import("../app/(tabs)/mood");
const { queryClient } = await import("../lib/query");
const { GuestModeContext } = await import("../lib/guest-mode");

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

function renderScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MoodScreen />
    </QueryClientProvider>,
  );
}

describe("MoodScreen: 表示", () => {
  it("今日まだ記録していないとき、その旨が出る", async () => {
    listMock.mockResolvedValue({ mine: [], partner: null });

    renderScreen();

    expect(await screen.findByText("今日: まだ記録していません")).toBeTruthy();
  });

  it("今日の記録があれば言葉で出る（色だけで区別しない）", async () => {
    listMock.mockResolvedValue({ mine: [{ date: "2026-01-01", level: 4 }], partner: null });

    renderScreen();

    expect(await screen.findByText("今日: よい")).toBeTruthy();
  });

  it("相手が未参加のときは相手の段が出ない", async () => {
    listMock.mockResolvedValue({ mine: [], partner: null });

    renderScreen();
    await screen.findByText("わたし");

    expect(screen.queryByText("相手")).toBeNull();
  });

  it("相手がいれば名前付きで相手の段が出る", async () => {
    listMock.mockResolvedValue({
      mine: [],
      partner: { name: "れん", items: [{ date: "2026-01-01", level: 2 }] },
    });

    renderScreen();

    expect(await screen.findByText("れん")).toBeTruthy();
  });

  it("取得に失敗すると再試行ボタンが出る", async () => {
    listMock.mockRejectedValue(new Error("network"));

    renderScreen();

    expect(await screen.findByText("読み込めませんでした", {}, { timeout: 10000 })).toBeTruthy();
    expect(screen.getByText("再試行")).toBeTruthy();
  }, 15000);
});

describe("MoodScreen: 記録", () => {
  // monthQuery・todayQueryの2本が同じmood.listを呼ぶため、両方が同じ可変値を
  // 参照するmockImplementationにする（mockResolvedValueOnceの積み方だと
  // どちらが先に呼ばれるかに結果が依存してしまう）
  it("段階を選ぶとmood.setTodayが呼ばれ、選択が反映される", async () => {
    let mine: { date: string; level: number }[] = [];
    listMock.mockImplementation(async () => ({ mine, partner: null }));
    setTodayMock.mockImplementation(async (input: { level: number }) => {
      mine = [{ date: "2026-01-01", level: input.level }];
      return { date: "2026-01-01", level: input.level };
    });

    renderScreen();
    await screen.findByText("今日: まだ記録していません");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("ふつう"));
      await Promise.resolve();
    });

    await waitFor(() => expect(setTodayMock).toHaveBeenCalledWith({ level: 3 }, expect.anything()));
    expect(await screen.findByText("今日: ふつう")).toBeTruthy();
  });

  // タスク定義11節: もう一度押すと取り消す
  it("選択中の段階をもう一度押すとmood.clearTodayが呼ばれ、選択が外れる", async () => {
    let mine: { date: string; level: number }[] = [{ date: "2026-01-01", level: 5 }];
    listMock.mockImplementation(async () => ({ mine, partner: null }));
    clearTodayMock.mockImplementation(async () => {
      mine = [];
      return { date: "2026-01-01" };
    });

    renderScreen();
    await screen.findByText("今日: とてもよい");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("とてもよい"));
      await Promise.resolve();
    });

    await waitFor(() => expect(clearTodayMock).toHaveBeenCalledWith(undefined, expect.anything()));
    expect(await screen.findByText("今日: まだ記録していません")).toBeTruthy();
  });
});

describe("MoodScreen: ゲスト閲覧", () => {
  it("選択ボタンの代わりにログイン導線が出る", async () => {
    listMock.mockResolvedValue({ mine: [], partner: null });
    const exitGuestMode = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <GuestModeContext.Provider
          value={{ isGuestMode: true, enterGuestMode: vi.fn(), exitGuestMode, demoUnavailable: false }}
        >
          <MoodScreen />
        </GuestModeContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("記録はログインすると使えます")).toBeTruthy();
    expect(screen.queryByLabelText("ふつう")).toBeNull();

    fireEvent.click(screen.getByText("ログイン"));
    expect(exitGuestMode).toHaveBeenCalled();
  });
});

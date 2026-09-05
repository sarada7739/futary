import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 020: ホーム画面（記念日カード + 機能パネル）の画面結合テスト。
// calendar-screen.test.tsxと同じ形でoRPCクライアントをモックする
const { statsGetMock, pushMock } = vi.hoisted(() => ({
  statsGetMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { stats: { get: statsGetMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

// useViewerQueryKey（apps/app/lib/viewer-key.ts。stats-card.tsx経由）が
// auth-client経由でuseSessionを参照する。expo-router等と同じ理由でモックする
vi.mock("../lib/auth-client", () => ({
  useSession: () => ({ data: null }),
}));

const { default: HomeScreen } = await import("../app/(tabs)/index");
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
  statsGetMock.mockResolvedValue(makeStats());
});

function renderScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <HomeScreen />
    </QueryClientProvider>,
  );
}

describe("HomeScreen: 記念日カード", () => {
  it("統計カード（ふたりのアバター・記念日・会った日数）が表示される", async () => {
    statsGetMock.mockResolvedValue(makeStats({ daysTogether: { status: "dating", days: 365 }, meetupDays: 12 }));

    renderScreen();

    // 035: 「付き合って」「365」「日目」は別々のTextで描画される
    // （daysTogetherParts。stats-card.test.tsxと同じ理由）
    expect(await screen.findByTestId("stats-card-days-prefix")).toHaveTextContent("付き合って");
    expect(screen.getByTestId("stats-card-days-number")).toHaveTextContent("365");
    expect(screen.getByTestId("stats-card-days-suffix")).toHaveTextContent("日目");
    expect(screen.getByTestId("stats-card-meetup-pill")).toHaveTextContent("会った日数：12日");
  });
});

describe("HomeScreen: 機能パネル", () => {
  it("動くパネル6枚（タイムライン・カレンダー・思い出・統計・リスト・気分の記録）が表示される", async () => {
    renderScreen();
    await screen.findByTestId("stats-card-meetup-pill");

    expect(screen.getByText("タイムライン")).toBeTruthy();
    expect(screen.getByText("カレンダー")).toBeTruthy();
    expect(screen.getByText("思い出")).toBeTruthy();
    expect(screen.getByText("統計")).toBeTruthy();
    expect(screen.getByText("リスト")).toBeTruthy();
    expect(screen.getByText("気分の記録")).toBeTruthy();
  });

  // 029: 「気分の記録」パネルにonPressが付き、次フェーズから動くパネルへ移った。
  // 035: 表示文言を「次フェーズ」（開発都合の言葉）から「COMING SOON」に変えた
  it("次フェーズのパネル2枚（今日どうだった？・AIまとめ）が「COMING SOON」表示で出る", async () => {
    renderScreen();
    await screen.findByTestId("stats-card-meetup-pill");

    for (const label of ["今日どうだった？", "AIまとめ"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // 2枚とも「COMING SOON」バッジを持つ（「準備中です」という文言は使わない）
    expect(screen.getAllByText("COMING SOON")).toHaveLength(2);
    expect(screen.queryByText("準備中です")).toBeNull();
    expect(screen.queryByText("次フェーズ")).toBeNull();
  });

  it("「準備中です」という文言がどこにも出ない", async () => {
    renderScreen();
    await screen.findByTestId("stats-card-meetup-pill");

    expect(screen.queryByText(/準備中/)).toBeNull();
  });

  it("タイムラインパネルを押すと /timeline へ遷移する", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("タイムライン"));

    expect(pushMock).toHaveBeenCalledWith("/timeline");
  });

  it("カレンダーパネルを押すと /calendar へ遷移する", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("カレンダー"));

    expect(pushMock).toHaveBeenCalledWith("/calendar");
  });

  it("思い出パネルを押すと /memory へ遷移する", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("思い出"));

    expect(pushMock).toHaveBeenCalledWith("/memory");
  });

  it("統計パネルを押すと /stats へ遷移する", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("統計"));

    expect(pushMock).toHaveBeenCalledWith("/stats");
  });

  it("リストパネルを押すと /list へ遷移する（027）", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("リスト"));

    expect(pushMock).toHaveBeenCalledWith("/list");
  });

  it("気分の記録パネルを押すと /mood へ遷移する（029）", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("気分の記録"));

    expect(pushMock).toHaveBeenCalledWith("/mood");
  });

  it("次フェーズのパネルを押しても何も起きない（遷移しない）", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("今日どうだった？"));

    expect(pushMock).not.toHaveBeenCalled();
  });
});

// 020「状態の網羅」: 統計の取得に失敗しても記念日カードだけ落ち、パネルは出る
describe("HomeScreen: 統計取得の失敗", () => {
  it("stats.getが失敗しても、パネルは表示され続ける（入口が消えない）", async () => {
    statsGetMock.mockRejectedValue(new Error("network"));

    renderScreen();

    expect(await screen.findByText("タイムライン")).toBeTruthy();
    expect(screen.getByText("カレンダー")).toBeTruthy();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 統計カードの画面結合テスト（012）。oRPC クライアントはモックする
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

// 記念日の数字を大きく見せるため「付き合って」「365」「日目」は別々の Text（daysTogetherParts）。
// 1 つの文字列として getByText できないので、testID で個別に見る
describe("StatsCard", () => {
  it("記念日が今日以前なら「付き合って○日目」を表示する", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "dating", days: 365 },
      meetupDays: 48,
      postCount: 10,
      photoCount: 5,
      members: [
        { userId: "u1", name: "Haruka", image: null },
        { userId: "u2", name: "Yuki", image: null },
      ],
    });

    renderCard();

    expect(await screen.findByTestId("stats-card-days-prefix")).toHaveTextContent("付き合って");
    expect(screen.getByTestId("stats-card-days-number")).toHaveTextContent("365");
    expect(screen.getByTestId("stats-card-days-suffix")).toHaveTextContent("日目");
    expect(screen.getByTestId("stats-card-meetup-pill")).toHaveTextContent("会った日数：48日");
    expect(screen.getByText("Haruka")).toBeTruthy();
    expect(screen.getByText("Yuki")).toBeTruthy();
    expect(screen.queryByText("招待中")).toBeNull();
  });

  it("記念日が未来なら「あと○日」を表示する（負の値を出さない）", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "dating_upcoming", days: 5 },
      meetupDays: 0,
      postCount: 0,
      photoCount: 0,
      members: [{ userId: "u1", name: "Haruka", image: null }],
    });

    renderCard();

    expect(await screen.findByTestId("stats-card-days-prefix")).toHaveTextContent("記念日まで あと");
    expect(screen.getByTestId("stats-card-days-number")).toHaveTextContent("5");
    expect(screen.getByTestId("stats-card-days-suffix")).toHaveTextContent("日");
    expect(screen.queryByText(/-/)).toBeNull();
  });

  it("会った日ゼロでも「会った日数：0日」が出て、カード自体は表示される", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "dating", days: 1 },
      meetupDays: 0,
      postCount: 0,
      photoCount: 0,
      members: [{ userId: "u1", name: "Haruka", image: null }],
    });

    renderCard();

    expect(await screen.findByTestId("stats-card-meetup-pill")).toHaveTextContent("会った日数：0日");
  });

  it("ペアが1人だけなら、相手の枠に「招待中」が出る", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "dating", days: 1 },
      meetupDays: 0,
      postCount: 0,
      photoCount: 0,
      members: [{ userId: "u1", name: "Haruka", image: null }],
    });

    renderCard();

    expect(await screen.findByText("招待中")).toBeTruthy();
  });

  // primary_date に従って daysTogether の表示を出し分ける（019）
  it("primaryDate='married'（結婚した日）なら「結婚して○日目」を表示する", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "married", days: 100 },
      meetupDays: 0,
      postCount: 0,
      photoCount: 0,
      members: [{ userId: "u1", name: "Haruka", image: null }],
    });

    renderCard();

    expect(await screen.findByTestId("stats-card-days-prefix")).toHaveTextContent("結婚して");
    expect(screen.getByTestId("stats-card-days-number")).toHaveTextContent("100");
    expect(screen.getByTestId("stats-card-days-suffix")).toHaveTextContent("日目");
  });

  it("primaryDate='married'・結婚した日が未来なら「結婚まで あと○日」を表示する", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "married_upcoming", days: 30 },
      meetupDays: 0,
      postCount: 0,
      photoCount: 0,
      members: [{ userId: "u1", name: "Haruka", image: null }],
    });

    renderCard();

    expect(await screen.findByTestId("stats-card-days-prefix")).toHaveTextContent("結婚まで あと");
    expect(screen.getByTestId("stats-card-days-number")).toHaveTextContent("30");
    expect(screen.getByTestId("stats-card-days-suffix")).toHaveTextContent("日");
  });

  it("primaryDate='none'（hidden）なら日数の表示が出ない", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "hidden" },
      meetupDays: 3,
      postCount: 0,
      photoCount: 0,
      members: [{ userId: "u1", name: "Haruka", image: null }],
    });

    renderCard();

    // 「会った日数：3日」は出る（daysTogether だけが隠れる）ので、読み込みはこちらで待つ
    await screen.findByTestId("stats-card-meetup-pill");
    expect(screen.queryByTestId("stats-card-days-prefix")).toBeNull();
    // hiddenは本人が隠すと決めたので、マイページへの導線は出さない（023）
    expect(screen.queryByText("付き合った日を設定する")).toBeNull();
  });

  // unset（まだ決めていない）は hidden と違い、マイページへの導線を出す（023）
  it("daysTogetherが'unset'なら日数の表示は出ず、マイページへの導線が出る", async () => {
    statsGetMock.mockResolvedValue({
      daysTogether: { status: "unset" },
      meetupDays: 0,
      postCount: 0,
      photoCount: 0,
      members: [{ userId: "u1", name: "Haruka", image: null }],
    });

    renderCard();

    const link = await screen.findByText("付き合った日を設定する");
    expect(screen.queryByTestId("stats-card-days-prefix")).toBeNull();

    fireEvent.click(link);
    expect(pushMock).toHaveBeenCalledWith("/profile");
  });

  // 取れなければエラー文と再試行ボタンを出す（何も知らせないまま情報が欠けないように。016）
  it(
    "通信エラー時はエラー文と再試行ボタンを表示する",
    async () => {
      statsGetMock.mockRejectedValue(new Error("network"));

      renderCard();

      // 既定のリトライ（3 回・指数バックオフ）が尽きるまで isError にならないので長めに待つ
      expect(await screen.findByText("記念日を読み込めませんでした", {}, { timeout: 10000 })).toBeTruthy();
      expect(screen.getByText("再試行")).toBeTruthy();
    },
    15000,
  );
});

import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceProvider, iconPanelList, panelPhotoList } from "@futary/ui";

// 039 段階2: a（ホームのロゴ）・b（記念日カード）・c（機能パネル）・f（統計のヒーロー）の
// 分岐が white のときだけ効き、pink では従来のままであることの検査（タスク定義 8節
// 「段階2のテスト」）。画面結合テストは home-screen.test.tsx 等と同じ形でモックする

const { statsGetMock, pushMock } = vi.hoisted(() => ({
  statsGetMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("expo-router", async () => {
  const { View } = await import("react-native");
  return {
    useRouter: () => ({ push: pushMock }),
    // 画面の中から <Tabs.Screen options> でヘッダを上書きする経路（f）。渡された
    // options を testID 付きの要素に写して、テストから読めるようにする
    Tabs: {
      Screen: ({ options }: { options: Record<string, unknown> }) => (
        <View testID="tabs-screen-options" accessibilityLabel={JSON.stringify(options)} />
      ),
    },
  };
});

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { stats: { get: statsGetMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: HomeScreen } = await import("../app/(tabs)/index");
const { default: StatsScreen } = await import("../app/(tabs)/stats");
const { StatsCard } = await import("../components/stats-card");
const { FeaturePanel } = await import("../components/feature-panel");
const { queryClient } = await import("../lib/query");

function makeStats() {
  return {
    daysTogether: { status: "dating", days: 569 },
    meetupDays: 94,
    postCount: 43,
    photoCount: 4,
    members: [
      { userId: "u1", name: "ゆい", image: null },
      { userId: "u2", name: "れん", image: null },
    ],
  };
}

function renderIn(appearance: "pink" | "white", ui: React.ReactElement) {
  return render(
    <AppearanceProvider initialAppearance={appearance}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </AppearanceProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  statsGetMock.mockResolvedValue(makeStats());
});

describe("a: ホームのロゴ", () => {
  it("white では文字の「futary」を描き、画像は描かない", async () => {
    renderIn("white", <HomeScreen />);
    const logo = await screen.findByTestId("home-logo-text");
    expect(logo).toHaveTextContent("futary");
    expect(logo.style.fontWeight).toBe("300");
    expect(screen.queryByTestId("home-logo-image")).toBeNull();
  });

  it("pink では画像のロゴのまま", async () => {
    renderIn("pink", <HomeScreen />);
    expect(await screen.findByTestId("home-logo-image")).toBeInTheDocument();
    expect(screen.queryByTestId("home-logo-text")).toBeNull();
  });
});

describe("b: 記念日カード", () => {
  it("white ではリング・ハート・「付き合って」・ピルが無く、「会った日数：94日」は素の文字", async () => {
    renderIn("white", <StatsCard />);
    expect(await screen.findByTestId("stats-card-shell-white")).toBeInTheDocument();
    expect(screen.getByTestId("stats-card-days-number")).toHaveTextContent("569");
    expect(screen.getByTestId("stats-card-days-suffix")).toHaveTextContent("日目");
    expect(screen.queryByTestId("stats-card-days-prefix")).toBeNull();
    expect(screen.queryByTestId("stats-card-heart")).toBeNull();
    expect(screen.queryByTestId("stats-card-meetup-pill")).toBeNull();
    expect(screen.getByTestId("stats-card-meetup-plain")).toHaveTextContent("会った日数：94日");
  });

  it("white でも未来の日付なら「記念日まで あと」は残す（数字の意味そのもの）", async () => {
    statsGetMock.mockResolvedValue({ ...makeStats(), daysTogether: { status: "dating_upcoming", days: 12 } });
    renderIn("white", <StatsCard />);
    expect(await screen.findByTestId("stats-card-days-prefix")).toHaveTextContent("記念日まで あと");
  });

  it("pink では従来どおり（ハート・「付き合って」・ピル）", async () => {
    renderIn("pink", <StatsCard />);
    expect(await screen.findByTestId("stats-card-days-prefix")).toHaveTextContent("付き合って");
    expect(screen.getByTestId("stats-card-heart")).toBeInTheDocument();
    expect(screen.getByTestId("stats-card-meetup-pill")).toBeInTheDocument();
    expect(screen.queryByTestId("stats-card-shell-white")).toBeNull();
    expect(screen.queryByTestId("stats-card-meetup-plain")).toBeNull();
  });
});

describe("c: 機能パネル", () => {
  it("white では写真タイル + ラベル + 「近日公開」。「COMING SOON」は出さない", () => {
    renderIn("white", <FeaturePanel label="今日どうだった？" icon={iconPanelList} photo={panelPhotoList} />);
    expect(screen.getByTestId("feature-panel-white")).toBeInTheDocument();
    expect(screen.getByTestId("feature-panel-photo")).toBeInTheDocument();
    expect(screen.getByText("今日どうだった？")).toBeInTheDocument();
    expect(screen.getByText("近日公開")).toBeInTheDocument();
    expect(screen.queryByText("COMING SOON")).toBeNull();
  });

  it("white で使えるパネルには「近日公開」の文字が無い", () => {
    renderIn("white", <FeaturePanel label="リスト" icon={iconPanelList} photo={panelPhotoList} onPress={() => {}} />);
    expect(screen.queryByText("近日公開")).toBeNull();
  });

  it("white で写真が無ければタイルの中に線画アイコンを置く（差し替え前でも壊れない）", () => {
    renderIn("white", <FeaturePanel label="リスト" icon={iconPanelList} onPress={() => {}} />);
    expect(screen.getByTestId("feature-panel-white")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-panel-photo")).toBeNull();
  });

  it("pink では従来どおり「COMING SOON」で、写真タイルは使わない", () => {
    renderIn("pink", <FeaturePanel label="今日どうだった？" icon={iconPanelList} photo={panelPhotoList} />);
    expect(screen.getByText("COMING SOON")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-panel-white")).toBeNull();
    expect(screen.queryByTestId("feature-panel-photo")).toBeNull();
    expect(screen.queryByText("近日公開")).toBeNull();
  });
});

describe("f: 統計のヒーロー", () => {
  it("white ではヒーロー写真と二段の見出し、区切り線の行になる", async () => {
    renderIn("white", <StatsScreen />);
    expect(await screen.findByTestId("stats-hero")).toBeInTheDocument();
    expect(screen.getAllByText("統計")).toHaveLength(2);
    expect(screen.getByTestId("stats-white-rows")).toBeInTheDocument();
    expect(screen.getByText("付き合って 569日目")).toBeInTheDocument();
    expect(screen.getByText("94日")).toBeInTheDocument();
  });

  it("white ではヘッダごと消す（「統計」が3回並ばない。Tabs のヘッダは題しか無い。A の指摘）", async () => {
    renderIn("white", <StatsScreen />);
    await screen.findByTestId("stats-hero");
    const options = JSON.parse(screen.getByTestId("tabs-screen-options").getAttribute("aria-label") ?? "{}");
    expect(options).toEqual({ headerShown: false });
  });

  it("pink ではヘッダを上書きしない（(tabs)/_layout.tsx の題「統計」のまま）", async () => {
    renderIn("pink", <StatsScreen />);
    await screen.findByText("付き合って 569日目");
    expect(screen.queryByTestId("tabs-screen-options")).toBeNull();
  });

  it("pink ではヒーローも二段見出しも無い", async () => {
    renderIn("pink", <StatsScreen />);
    expect(await screen.findByText("付き合って 569日目")).toBeInTheDocument();
    expect(screen.queryByTestId("stats-hero")).toBeNull();
    expect(screen.queryByTestId("stats-white-rows")).toBeNull();
    expect(screen.queryByText("統計")).toBeNull();
  });
});

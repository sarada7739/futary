import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceProvider, iconPanelList, panelPhotoList } from "@futary/ui";

// ホームのロゴ（a）・記念日カード（b）・機能パネル（c）・統計のヒーロー（f）の分岐が white のときだけ
// 効き、pink ではそのままであることの検査（039 8節「段階2のテスト」）

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

// ロゴは両モードで同じワードマーク画像（051 T4）
describe("a: ホームのロゴ", () => {
  it("white でも pink でも同じ画像のロゴで、文字ロゴ（home-logo-text）は無い", async () => {
    const white = renderIn("white", <HomeScreen />);
    const whiteLogo = await screen.findByTestId("home-logo-image");
    expect(whiteLogo).toHaveAttribute("aria-label", "Nisoine");
    expect(screen.queryByTestId("home-logo-text")).toBeNull();
    const whiteSrc = whiteLogo.querySelector("img")?.getAttribute("src") ?? whiteLogo.style.backgroundImage;
    white.unmount();

    renderIn("pink", <HomeScreen />);
    const pinkLogo = await screen.findByTestId("home-logo-image");
    expect(screen.queryByTestId("home-logo-text")).toBeNull();
    const pinkSrc = pinkLogo.querySelector("img")?.getAttribute("src") ?? pinkLogo.style.backgroundImage;
    expect(pinkSrc).toBe(whiteSrc);
    expect(pinkSrc).toBeTruthy();
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
  // ピンクもホワイトも同じ形（062）
  it.each(["white", "pink"] as const)("%s: 写真タイル + ラベル + 「近日公開」", (appearance) => {
    renderIn(appearance, <FeaturePanel label="今日どうだった？" icon={iconPanelList} photo={panelPhotoList} />);
    expect(screen.getByTestId("feature-panel")).toBeInTheDocument();
    expect(screen.getByTestId("feature-panel-photo")).toBeInTheDocument();
    expect(screen.getByText("今日どうだった？")).toBeInTheDocument();
    expect(screen.getByText("近日公開")).toBeInTheDocument();
  });

  it.each(["white", "pink"] as const)("%s: 使えるパネルには「近日公開」の文字が無い", (appearance) => {
    renderIn(appearance, <FeaturePanel label="リスト" icon={iconPanelList} photo={panelPhotoList} onPress={() => {}} />);
    expect(screen.getByTestId("feature-panel-photo")).toBeInTheDocument();
    expect(screen.queryByText("近日公開")).toBeNull();
  });

  it.each(["white", "pink"] as const)("%s: 写真が無ければタイルの中に線画アイコン（差し替え前でも壊れない）", (appearance) => {
    renderIn(appearance, <FeaturePanel label="リスト" icon={iconPanelList} onPress={() => {}} />);
    expect(screen.getByTestId("feature-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-panel-photo")).toBeNull();
  });

  // 062 T2: 外観の違いは useTheme() の色と影だけ。部品の中で appearance を読まない
  it("feature-panel.tsx は appearance を読まない（062 T2）", () => {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "components", "feature-panel.tsx"), "utf8");
    // コメントは除いて見る（コメントには「appearance を読まない」と書いてある）
    const code = source.replace(/\/\*[^]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/\bappearance\b/);
    expect(source).not.toContain("COMING SOON");
    expect(source).not.toContain("feature-panel-white");
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

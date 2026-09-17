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
  // 041・T13: パネルは 9 枚で「アルバム」があり「今日どうだった？」が無い。他の 8 枚の並びは
  // 変わっていない（「今日どうだった？」の位置〈2 行目の真ん中〉にアルバムが入っただけ）
  it("パネルが 9 枚で、並びは タイムライン・カレンダー・思い出・統計・アルバム・リスト・ほしいもの・気分の記録・AIまとめ", async () => {
    renderScreen();
    await screen.findByTestId("stats-card-meetup-pill");

    // 043: 3×3 の下に「リリース履歴を見る」（全幅 1 本。パネルではない）が加わった。並びの末尾
    const labels = screen.getAllByRole("button").map((el) => el.getAttribute("aria-label")).filter((l) => l !== null);
    expect(labels).toEqual([
      "タイムライン", "カレンダー", "思い出", "統計", "アルバム", "リスト", "ほしいもの", "気分の記録", "AIまとめ",
      "リリース履歴を見る",
    ]);
    expect(screen.queryByText("今日どうだった？")).toBeNull();
  });

  // 041: 次フェーズのパネルは無くなった（「今日どうだった？」をアルバムに置き換えた）。
  // 035: 表示文言を「次フェーズ」（開発都合の言葉）から「COMING SOON」に変えた経緯は残す
  // 062 T3: ピンク（既定の外観）でも 9 枚とも写真タイル
  it("パネル 9 枚に写真タイル（feature-panel-photo）が 9 つ（062）", async () => {
    renderScreen();
    await screen.findByTestId("stats-card-meetup-pill");
    expect(screen.getAllByTestId("feature-panel-photo")).toHaveLength(9);
  });

  it("「COMING SOON」「準備中です」「次フェーズ」という文言がどこにも出ない", async () => {
    renderScreen();
    await screen.findByTestId("stats-card-meetup-pill");

    expect(screen.queryByText("COMING SOON")).toBeNull();
    expect(screen.queryByText(/準備中/)).toBeNull();
    expect(screen.queryByText("次フェーズ")).toBeNull();
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

  it("ほしいものパネルを押すと /want へ遷移する（040）", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("ほしいもの"));
    expect(pushMock).toHaveBeenCalledWith("/want");
  });

  it("AIまとめパネルを押すと /ai-summary へ遷移する（037）", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("AIまとめ"));

    expect(pushMock).toHaveBeenCalledWith("/ai-summary");
  });

  it("アルバムパネルを押すと /album へ遷移する（041）", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("アルバム"));

    expect(pushMock).toHaveBeenCalledWith("/album");
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

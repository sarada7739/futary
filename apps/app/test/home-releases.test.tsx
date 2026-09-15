import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { AppearanceProvider } from "@futary/ui";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 043: ホームのリリース履歴のボタン（T2）・「新機能のお知らせ」のシート（T3）・一覧を開くと
// ホームのバッジが消える（T4）・オンボーディングにはシートが出ない（T6）の画面結合テスト。
// home-screen.test.tsx と同じ形で oRPC をモックする
const { statsGetMock, pushMock, setOptionsMock } = vi.hoisted(() => ({
  statsGetMock: vi.fn(),
  pushMock: vi.fn(),
  setOptionsMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock }),
  useNavigation: () => ({ setOptions: setOptionsMock }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { stats: { get: statsGetMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({ data: null }),
}));

// 048 段階2: 最新は 3.1.0「プレミアムプランを始めました」（route /premium）。route 無しの形（3.0.0）は
// 最新を差し替えて見る（実体の配列は触らない）
const releasesState = vi.hoisted(() => ({ latestOverride: null as null | { version: string; date: string; title: string; items: string[]; route?: string } }));
vi.mock("../lib/releases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/releases")>();
  return {
    ...actual,
    get LATEST_RELEASE() {
      return releasesState.latestOverride ?? actual.LATEST_RELEASE;
    },
  };
});

const { default: HomeScreen } = await import("../app/(tabs)/index");
const { default: ReleasesScreen } = await import("../app/(tabs)/releases");
const { default: OnboardingChoiceScreen } = await import("../app/(onboarding)/index");
const { queryClient } = await import("../lib/query");
const { RELEASE_SEEN_STORAGE_KEY, RELEASE_LATER_STORAGE_KEY } = await import("../lib/release-seen");
const { LATEST_VERSION } = await import("../lib/releases");

function makeStats() {
  return {
    daysTogether: { status: "dating", days: 1 },
    meetupDays: 0,
    postCount: 0,
    photoCount: 0,
    members: [{ userId: "u1", name: "自分", image: null }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  releasesState.latestOverride = null;
  statsGetMock.mockResolvedValue(makeStats());
});

function renderIn(ui: ReactElement, appearance: "pink" | "white" = "pink") {
  return render(
    <AppearanceProvider initialAppearance={appearance}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </AppearanceProvider>,
  );
}

async function renderHome(appearance: "pink" | "white" = "pink") {
  const result = renderIn(<HomeScreen />, appearance);
  // 両モードにある testID で待つ（meetup-pill はピンクだけ）
  await screen.findByTestId("stats-card-days-number");
  return result;
}

// react-native-web の Modal（animationType="fade"）は閉じるとき CSS の animationend を待ってから
// DOM から消す。jsdom はアニメーションを実行しないので、閉じる操作のあとに手で発火する
// （components/sheet.tsx のコメント）。ModalAnimation の div は currentTarget === target のときだけ
// 反応する（閉じる途中は role="dialog" も外れて探せない）ので、body の下の全要素に直接発火する。
// jsdom には AnimationEvent が無く、React は接頭辞付きの webkitAnimationEnd を聞く（実測。
// fireEvent.animationEnd では届かない）ので、両方の名前で発火する
function finishModalAnimations() {
  for (const node of Array.from(document.body.querySelectorAll("*"))) {
    node.dispatchEvent(new Event("webkitAnimationEnd", { bubbles: true }));
    node.dispatchEvent(new Event("animationend", { bubbles: true }));
  }
}

async function expectSheetClosed() {
  act(() => finishModalAnimations());
  await waitFor(() => expect(screen.queryByTestId("release-sheet")).toBeNull());
}

function markSeen() {
  window.localStorage.setItem(RELEASE_SEEN_STORAGE_KEY, LATEST_VERSION);
}

describe("ホームの「リリース履歴を見る」（043 T2）", () => {
  it("未読なら NEW が付き、押すと /releases へ", async () => {
    await renderHome();
    expect(screen.getByTestId("release-button-new")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("リリース履歴を見る"));
    expect(pushMock).toHaveBeenCalledWith("/releases");
  });

  it("既読なら NEW が無い（ボタンはある）", async () => {
    markSeen();
    await renderHome();
    expect(screen.getByLabelText("リリース履歴を見る")).toBeTruthy();
    expect(screen.queryByTestId("release-button-new")).toBeNull();
  });

  it("localStorage が例外を投げる環境では NEW もシートも出ない（0節 #9）", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      await renderHome();
      expect(screen.getByLabelText("リリース履歴を見る")).toBeTruthy();
      expect(screen.queryByTestId("release-button-new")).toBeNull();
      expect(screen.queryByTestId("release-sheet")).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", original);
    }
  });

  it("ホワイトでも同じ（ボタンと NEW）", async () => {
    await renderHome("white");
    expect(screen.getByLabelText("リリース履歴を見る")).toBeTruthy();
    expect(screen.getByTestId("release-button-new")).toBeTruthy();
  });
});

describe("「新機能のお知らせ」のシート（043 T3）", () => {
  it("未読なら出る。最新の 1 項目（プレミアムプランを始めました。048 段階2）だけで、題名・2 行・「使ってみる」（/premium）。/premium はパネルの写真が無いので絵は無い", async () => {
    await renderHome();
    expect(screen.getByTestId("release-sheet")).toBeTruthy();
    expect(screen.getByText("新機能のお知らせ")).toBeTruthy();
    expect(screen.getByText("もっと便利に、もっと楽しく。")).toBeTruthy();
    expect(screen.getByText("プレミアムプランを始めました")).toBeTruthy();
    expect(screen.getByText("写真を 5 万枚まで保存できます")).toBeTruthy();
    expect(screen.getByText("月額と年額から選べます")).toBeTruthy();
    expect(screen.getByTestId("release-sheet-try")).toBeTruthy();
    expect(screen.queryByTestId("release-sheet-photo")).toBeNull();
    // 1 つ前の版は出ない（複数を溜めない）
    expect(screen.queryByText("Nisoine になりました")).toBeNull();
  });

  it("route 無しの版（3.0.0 の形）なら「使ってみる」と絵は無い（最新を差し替えて）", async () => {
    releasesState.latestOverride = {
      version: "9.9.8",
      date: "2026-09-15",
      title: "Nisoine になりました",
      items: ["アプリの名前が Nisoine になりました", "見た目と機能はそのままです"],
    };
    await renderHome();
    expect(screen.getByText("Nisoine になりました")).toBeTruthy();
    expect(screen.queryByTestId("release-sheet-try")).toBeNull();
    expect(screen.queryByTestId("release-sheet-photo")).toBeNull();
  });

  it("route のある版（2.3.0 の形）なら題名・先頭 2 行・「使ってみる」・絵がある", async () => {
    releasesState.latestOverride = {
      version: "9.9.9",
      date: "2026-09-15",
      title: "タイムラインをすっきりさせました",
      items: ["投稿の余白を詰めて、一覧で多く見えるようにしました", "縦長の写真は高さを揃えました", "3 行目"],
      route: "/timeline",
    };
    await renderHome();
    expect(screen.getByText("タイムラインをすっきりさせました")).toBeTruthy();
    expect(screen.getByText("投稿の余白を詰めて、一覧で多く見えるようにしました")).toBeTruthy();
    expect(screen.getByText("縦長の写真は高さを揃えました")).toBeTruthy();
    expect(screen.queryByText("3 行目")).toBeNull();
    expect(screen.getByTestId("release-sheet-try")).toBeTruthy();
    expect(screen.getByTestId("release-sheet-photo")).toBeTruthy();
  });

  it("「閉じる ×」で消えて既読になる（NEW も消える）", async () => {
    await renderHome();
    fireEvent.click(screen.getByTestId("release-sheet-close"));
    await expectSheetClosed();
    expect(window.localStorage.getItem(RELEASE_SEEN_STORAGE_KEY)).toBe(LATEST_VERSION);
    expect(screen.queryByTestId("release-button-new")).toBeNull();
  });

  it("シートの外を押しても消えて既読になる（0節 #5）", async () => {
    await renderHome();
    fireEvent.click(screen.getByLabelText("閉じる"));
    await expectSheetClosed();
    expect(window.localStorage.getItem(RELEASE_SEEN_STORAGE_KEY)).toBe(LATEST_VERSION);
  });

  it("「後で通知する」で消えるが未読のまま（NEW は残る）。同じ起動でホームを開き直しても出ない", async () => {
    const { unmount } = await renderHome();
    fireEvent.click(screen.getByTestId("release-sheet-later"));
    await expectSheetClosed();
    expect(window.localStorage.getItem(RELEASE_SEEN_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(RELEASE_LATER_STORAGE_KEY)).toBe(LATEST_VERSION);
    expect(screen.getByTestId("release-button-new")).toBeTruthy();

    // ホームを開き直す（同じ起動 = sessionStorage が残っている）
    unmount();
    await renderHome();
    expect(screen.queryByTestId("release-sheet")).toBeNull();
    expect(screen.getByTestId("release-button-new")).toBeTruthy();
  });

  it("「後で」のあと、次の起動（sessionStorage が空）ではまた出る", async () => {
    const { unmount } = await renderHome();
    fireEvent.click(screen.getByTestId("release-sheet-later"));
    await expectSheetClosed();
    unmount();

    window.sessionStorage.clear();
    await renderHome();
    expect(screen.getByTestId("release-sheet")).toBeTruthy();
  });

  it("「使ってみる」で route へ進み、既読になる（最新を route 付きに差し替えて）", async () => {
    releasesState.latestOverride = { version: LATEST_VERSION, date: "2026-09-15", title: "x", items: ["a"], route: "/timeline" };
    await renderHome();
    fireEvent.click(screen.getByTestId("release-sheet-try"));
    await expectSheetClosed();
    expect(pushMock).toHaveBeenCalledWith("/timeline");
    expect(window.localStorage.getItem(RELEASE_SEEN_STORAGE_KEY)).toBe(LATEST_VERSION);
  });

  it("既読なら出ない", async () => {
    markSeen();
    await renderHome();
    expect(screen.queryByTestId("release-sheet")).toBeNull();
  });

  it("ホワイトは贈り物の絵、ピンクは星（分岐は部品の中）", async () => {
    const { unmount } = await renderHome("white");
    expect(screen.getByTestId("release-sheet-gift")).toBeTruthy();
    expect(screen.queryByTestId("release-sheet-sparkle")).toBeNull();
    unmount();
    await renderHome("pink");
    expect(screen.getByTestId("release-sheet-sparkle")).toBeTruthy();
    expect(screen.queryByTestId("release-sheet-gift")).toBeNull();
  });
});

describe("一覧を開くと既読になる（043 T4）", () => {
  it("ホームの NEW が、一覧の画面を開いた瞬間に消える", async () => {
    await renderHome();
    // シートは邪魔なので「後で」で閉じておく（未読のまま）
    fireEvent.click(screen.getByTestId("release-sheet-later"));
    await expectSheetClosed();
    expect(screen.getByTestId("release-button-new")).toBeTruthy();

    // Tabs の中ではホームは mount されたまま。一覧を同じツリーに足して開いたことにする
    renderIn(<ReleasesScreen />);
    expect(window.localStorage.getItem(RELEASE_SEEN_STORAGE_KEY)).toBe(LATEST_VERSION);
    await waitFor(() => expect(screen.queryByTestId("release-button-new")).toBeNull());
  });
});

describe("オンボーディングにはシートが出ない（043 T6）", () => {
  it("未読でも「新機能のお知らせ」が無い", () => {
    renderIn(<OnboardingChoiceScreen />);
    expect(screen.getByText("ふたりをはじめる")).toBeTruthy();
    expect(screen.queryByTestId("release-sheet")).toBeNull();
    expect(screen.queryByText("新機能のお知らせ")).toBeNull();
  });
});

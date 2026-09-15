import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { AppearanceProvider } from "@futary/ui";
import type { ReactElement } from "react";
import { Linking } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 048 段階2・P6/P7: /premium。free で価格とボタン・paid で「プランを管理」・ゲストで「ログインして始める」・
// ?status=success の読み直し。「トライアル」「無制限」の文字が無い。「特定商取引法に基づく表記」「利用規約」へのリンク。
// ‹ 戻る は履歴があれば back()、無ければ /album（045 から）。ヘッダーは navigation.setOptions で置くため、
// 渡された headerLeft を描画して確かめる（releases-screen.test.tsx と同じ形）
const { pushMock, backMock, canGoBackMock, setOptionsMock, searchParams, coupleGetMock, pricesMock, checkoutMock, portalMock } =
  vi.hoisted(() => ({
    pushMock: vi.fn(),
    backMock: vi.fn(),
    canGoBackMock: vi.fn(() => true),
    setOptionsMock: vi.fn(),
    searchParams: { status: undefined as string | undefined },
    coupleGetMock: vi.fn(),
    pricesMock: vi.fn(),
    checkoutMock: vi.fn(),
    portalMock: vi.fn(),
  }));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock, back: backMock, canGoBack: canGoBackMock }),
  useNavigation: () => ({ setOptions: setOptionsMock }),
  useLocalSearchParams: () => ({ status: searchParams.status }),
}));

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    couple: { get: coupleGetMock },
    billing: { prices: pricesMock, createCheckoutSession: checkoutMock, createPortalSession: portalMock },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: PremiumScreen } = await import("../app/(tabs)/premium");
const { GuestModeContext } = await import("../lib/guest-mode");
const { queryClient } = await import("../lib/query");

const PRICES = {
  monthly: { amount: 420, currency: "jpy", priceId: "price_m" },
  yearly: { amount: 4200, currency: "jpy", priceId: "price_y" },
};

function makeCouple(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "couple-1",
    datingDate: null,
    marriedDate: null,
    primaryDate: "dating",
    createdAt: 0,
    plan: "free",
    albumQuota: { limit: 30, used: 0 },
    planSource: null,
    planExpiresAt: null,
    planCancelAt: null,
    ...overrides,
  };
}

// window.location.assign を差し替える（jsdom の location は書き換えられないので Object.defineProperty）
let assigned: string[] = [];
const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  canGoBackMock.mockReturnValue(true);
  searchParams.status = undefined;
  coupleGetMock.mockResolvedValue(makeCouple());
  pricesMock.mockResolvedValue(PRICES);
  checkoutMock.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/x" });
  portalMock.mockResolvedValue({ url: "https://billing.stripe.com/p/session/x" });
  assigned = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign: (url: string) => assigned.push(url), origin: "http://localhost" },
  });
});

function renderIn(ui: ReactElement, appearance: "pink" | "white" = "pink") {
  return render(
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider initialAppearance={appearance}>{ui}</AppearanceProvider>
    </QueryClientProvider>,
  );
}

function renderAsGuest() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider initialAppearance="pink">
        <GuestModeContext.Provider
          value={{ isGuestMode: true, enterGuestMode: () => {}, exitGuestMode: exitGuestModeMock, demoUnavailable: false }}
        >
          <PremiumScreen />
        </GuestModeContext.Provider>
      </AppearanceProvider>
    </QueryClientProvider>,
  );
}
const exitGuestModeMock = vi.fn();

function renderHeaderLeft() {
  const last = setOptionsMock.mock.calls.at(-1)?.[0] as { headerLeft?: () => ReactElement } | undefined;
  if (!last?.headerLeft) return null;
  return render(last.headerLeft());
}

describe("PremiumScreen（048 段階2 P6）: free", () => {
  it("題名・副題・「できること」の 2 行・月額の価格・「プレミアムを始める →」・「いつでも解約できます・自動更新」", async () => {
    renderIn(<PremiumScreen />);
    expect(screen.getByTestId("premium-title")).toHaveTextContent("プレミアムプラン");
    expect(screen.getByText("大切な思い出を、もっと自由に。")).toBeTruthy();
    expect(screen.getByText("写真 50 万枚まで")).toBeTruthy();
    expect(screen.queryByText(/5 万枚/)).toBeNull();
    expect(screen.getByText("アルバムはいくつでも")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("premium-price")).toHaveTextContent("¥420 / 月"));
    expect(screen.getByTestId("premium-start")).toHaveTextContent("プレミアムを始める →");
    expect(screen.getByText("いつでも解約できます・自動更新")).toBeTruthy();
    expect(screen.queryByTestId("premium-current")).toBeNull();
  });

  it("年額に切り替えると価格が「¥4,200 / 年」。始めると createCheckoutSession({ interval }) → Checkout の URL へ", async () => {
    renderIn(<PremiumScreen />);
    await waitFor(() => expect(screen.getByTestId("premium-price")).toHaveTextContent("¥420 / 月"));
    fireEvent.click(screen.getByTestId("premium-interval-year"));
    expect(screen.getByTestId("premium-price")).toHaveTextContent("¥4,200 / 年");

    fireEvent.click(screen.getByTestId("premium-start"));
    await waitFor(() => expect(checkoutMock).toHaveBeenCalledTimes(1));
    expect(checkoutMock.mock.calls[0]?.[0]).toEqual({ interval: "year" });
    await waitFor(() => expect(assigned).toEqual(["https://checkout.stripe.com/c/pay/x"]));
  });

  it("CONFLICT（既にプレミアム）なら「すでにプレミアムです」。他の失敗は「始められませんでした」", async () => {
    checkoutMock.mockRejectedValueOnce(new ORPCError("CONFLICT", { status: 409 }));
    renderIn(<PremiumScreen />);
    await waitFor(() => expect(screen.getByTestId("premium-price")).toHaveTextContent("¥420 / 月"));
    fireEvent.click(screen.getByTestId("premium-start"));
    await waitFor(() => expect(screen.getByTestId("premium-checkout-error")).toHaveTextContent("すでにプレミアムです"));
    expect(assigned).toEqual([]);

    checkoutMock.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(screen.getByTestId("premium-start"));
    await waitFor(() => expect(screen.getByTestId("premium-checkout-error")).toHaveTextContent("始められませんでした"));
  });

  it("価格が読めなければ「価格を読み込めませんでした」でボタンは押せない", async () => {
    pricesMock.mockRejectedValue(new Error("stripe down"));
    renderIn(<PremiumScreen />);
    // 既定の再試行（3 回・指数の待ち）を待つ
    await waitFor(() => expect(screen.getByTestId("premium-price")).toHaveTextContent("価格を読み込めませんでした"), {
      timeout: 10_000,
    });
    // RN Web の Button は aria-disabled で表す
    expect(screen.getByTestId("premium-start")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("premium-start"));
    expect(checkoutMock).not.toHaveBeenCalled();
  }, 15_000);
});

describe("PremiumScreen（P6）: paid", () => {
  it("stripe の paid: 「プレミアムです」と「プランを管理」（→ Portal の URL）。価格とボタンは無い", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ plan: "paid", albumQuota: null, planSource: "stripe", planExpiresAt: 1_800_000_000 }));
    renderIn(<PremiumScreen />);
    await waitFor(() => expect(screen.getByTestId("premium-current")).toHaveTextContent("プレミアムです"));
    expect(screen.queryByTestId("premium-start")).toBeNull();
    expect(screen.queryByTestId("premium-price")).toBeNull();
    fireEvent.click(screen.getByTestId("premium-manage"));
    await waitFor(() => expect(portalMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(assigned).toEqual(["https://billing.stripe.com/p/session/x"]));
  });

  it("期間の終わりで解約済み: 「プレミアムです」の下に「プレミアム（10月15日まで）」", async () => {
    const end = Date.UTC(2026, 9, 14, 15, 0, 0) / 1000;
    coupleGetMock.mockResolvedValue(makeCouple({ plan: "paid", albumQuota: null, planSource: "stripe", planExpiresAt: end, planCancelAt: end }));
    renderIn(<PremiumScreen />);
    await waitFor(() => expect(screen.getByTestId("premium-cancel-at")).toHaveTextContent("プレミアム（10月15日まで）"));
    expect(screen.getByTestId("premium-manage")).toBeTruthy();
  });

  it("manual の paid（運営のペア）: 「プレミアムです」だけ。「プランを管理」は無い", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ plan: "paid", albumQuota: null, planSource: "manual", planExpiresAt: null }));
    renderIn(<PremiumScreen />);
    await waitFor(() => expect(screen.getByTestId("premium-current")).toBeTruthy());
    expect(screen.queryByTestId("premium-manage")).toBeNull();
  });
});

describe("PremiumScreen（P6）: ゲスト", () => {
  it("価格は見られるがボタンは「ログインして始める」（→ exitGuestMode）。デモが paid でも申し込み側の表示", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ plan: "paid", albumQuota: null, planSource: "manual" }));
    renderAsGuest();
    await waitFor(() => expect(screen.getByTestId("premium-price")).toHaveTextContent("¥420 / 月"));
    expect(screen.queryByTestId("premium-start")).toBeNull();
    expect(screen.queryByTestId("premium-current")).toBeNull();
    fireEvent.click(screen.getByTestId("premium-login"));
    expect(exitGuestModeMock).toHaveBeenCalledTimes(1);
    expect(checkoutMock).not.toHaveBeenCalled();
  });
});

describe("PremiumScreen（P6）: ?status=success の読み直し", () => {
  it("「反映しています…」→ couple.get が paid になったら「プレミアムになりました」", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      searchParams.status = "success";
      coupleGetMock.mockResolvedValueOnce(makeCouple()).mockResolvedValue(
        makeCouple({ plan: "paid", albumQuota: null, planSource: "stripe", planExpiresAt: 1_800_000_000 }),
      );
      renderIn(<PremiumScreen />);
      expect(screen.getByTestId("premium-confirming")).toHaveTextContent("反映しています…");
      await waitFor(() => expect(coupleGetMock).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      await waitFor(() => expect(coupleGetMock.mock.calls.length).toBeGreaterThanOrEqual(2));
      await waitFor(() => expect(screen.getByTestId("premium-confirmed")).toHaveTextContent("プレミアムになりました"));
      expect(screen.queryByTestId("premium-confirming")).toBeNull();
      expect(screen.getByTestId("premium-current")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("30 秒経っても free のままなら「少し時間がかかることがあります。マイページで確かめてください」", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      searchParams.status = "success";
      renderIn(<PremiumScreen />);
      expect(screen.getByTestId("premium-confirming")).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      await waitFor(() => expect(screen.getByTestId("premium-confirm-timeout")).toHaveTextContent("マイページで確かめてください"));
      expect(coupleGetMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("status 無しなら何も出ない・読み直さない", async () => {
    renderIn(<PremiumScreen />);
    await waitFor(() => expect(coupleGetMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("premium-confirming")).toBeNull();
    expect(screen.queryByTestId("premium-confirmed")).toBeNull();
  });
});

describe("PremiumScreen（P7）: 文言とリンク", () => {
  it("「トライアル」「お試し」「無制限」の文字が無い。存在しない機能を書かない", async () => {
    renderIn(<PremiumScreen />);
    await waitFor(() => expect(screen.getByTestId("premium-price")).toHaveTextContent("¥"));
    expect(screen.queryByText(/トライアル/)).toBeNull();
    expect(screen.queryByText(/お試し/)).toBeNull();
    expect(screen.queryByText(/無制限/)).toBeNull();
    expect(screen.queryByText(/アルバムグループ|高画質|優先サポート|動画/)).toBeNull();
  });

  it("「特定商取引法に基づく表記」「利用規約」へのリンクがあり、押すとランディングのページを開く。プライバシーは出さない", async () => {
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(true);
    renderIn(<PremiumScreen />);
    fireEvent.click(screen.getByTestId("legal-tokushoho"));
    expect(openUrl).toHaveBeenCalledWith(expect.stringMatching(/\/tokushoho$/));
    fireEvent.click(screen.getByTestId("legal-terms"));
    expect(openUrl).toHaveBeenCalledWith(expect.stringMatching(/\/terms$/));
    expect(screen.queryByTestId("legal-privacy")).toBeNull();
  });

  it("‹ 戻る: 履歴があれば back()、無ければ /album", () => {
    renderIn(<PremiumScreen />);
    renderHeaderLeft();
    fireEvent.click(screen.getByTestId("premium-back"));
    expect(backMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();

    canGoBackMock.mockReturnValue(false);
    fireEvent.click(screen.getByTestId("premium-back"));
    expect(pushMock).toHaveBeenCalledWith("/album");
  });

  it("絵はピンクでハート、ホワイトで ✦（どちらも既存の線画）", () => {
    const pink = renderIn(<PremiumScreen />, "pink");
    expect(screen.getByTestId("premium-picture-heart")).toBeTruthy();
    pink.unmount();
    renderIn(<PremiumScreen />, "white");
    expect(screen.getByTestId("premium-picture-sparkle")).toBeTruthy();
  });
});

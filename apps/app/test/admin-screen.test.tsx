import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { AppearanceProvider } from "@futary/ui";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 057 T7: 運営の画面（/app/admin）。全体の数 → 探す → 切り替え → 確認 → 直近の操作。
// source='stripe' のペアはボタンが無い。運営でなければ「この画面は見られません」

const { pushMock, setOptionsMock, meGetMock, coupleGetMock, statsMock, lookupMock, setPlanMock, actionsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  setOptionsMock: vi.fn(),
  meGetMock: vi.fn(),
  coupleGetMock: vi.fn(),
  statsMock: vi.fn(),
  lookupMock: vi.fn(),
  setPlanMock: vi.fn(),
  actionsMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), canGoBack: () => true }),
  useNavigation: () => ({ setOptions: setOptionsMock }),
}));

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "admin", name: "運営", email: "admin@example.com", image: null } } }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    me: { get: meGetMock },
    couple: { get: coupleGetMock },
    admin: { stats: statsMock, lookup: lookupMock, setPlan: setPlanMock, actions: actionsMock },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: AdminScreen } = await import("../app/(tabs)/admin");
const { queryClient } = await import("../lib/query");

const COUNT = { total: 12, today: 1, avg7d: 0.3 };
const STATS = { couples: COUNT, users: { total: 24, today: 2, avg7d: 0.6 }, paidCouples: { total: 3, today: 0, avg7d: 0 }, posts: COUNT, images: COUNT };
// 2026-09-16 12:00 JST
const NOW = Date.UTC(2026, 8, 16, 3, 0, 0) / 1000;

function lookupResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user: { email: "yui@example.com", createdAt: NOW - 86400 * 30, posts: 5, postImages: 7 },
    couple: {
      id: "couple-abcdef12",
      createdAt: NOW - 86400 * 29,
      members: 2,
      plan: "free",
      source: null,
      expiresAt: null,
      hasStripeCustomer: false,
      posts: 9,
      images: 20,
      albums: 2,
      ...overrides,
    },
  };
}

function renderIn(ui: ReactElement, appearance: "pink" | "white" = "pink") {
  return render(
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider initialAppearance={appearance}>{ui}</AppearanceProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  meGetMock.mockResolvedValue({ id: "admin", name: "運営", email: "admin@example.com", image: null, sessionIsFresh: true, aiOptIn: false, partnerAiOptIn: false });
  coupleGetMock.mockResolvedValue({ id: "couple-admin", plan: "paid", albumQuota: null, planState: { plan: "paid" }, planSource: "manual", planExpiresAt: null, planCancelAt: null, isAdmin: true });
  statsMock.mockResolvedValue(STATS);
  actionsMock.mockResolvedValue({ items: [] });
  lookupMock.mockResolvedValue(lookupResult());
  setPlanMock.mockResolvedValue({ plan: "paid" });
});

describe("AdminScreen（057 T7）", () => {
  it("運営でなければ「この画面は見られません」で、admin.* は呼ばない", async () => {
    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 0 }, planState: { plan: "free", lockAt: null, locked: false }, planSource: null, planExpiresAt: null, planCancelAt: null, isAdmin: false });
    renderIn(<AdminScreen />);
    expect(await screen.findByTestId("admin-forbidden")).toBeTruthy();
    expect(statsMock).not.toHaveBeenCalled();
    expect(actionsMock).not.toHaveBeenCalled();
  });

  it("運営: 見出しとメール・全体の数 5 つ（数・今日・7 日平均）・直近の操作「まだありません」", async () => {
    renderIn(<AdminScreen />);
    expect(await screen.findByTestId("admin-title")).toHaveTextContent("運営");
    await waitFor(() => expect(screen.getByTestId("admin-email")).toHaveTextContent("admin@example.com"));
    expect(await screen.findByTestId("admin-stat-couples")).toHaveTextContent("ペア");
    expect(screen.getByTestId("admin-stat-couples")).toHaveTextContent("12");
    expect(screen.getByTestId("admin-stat-couples")).toHaveTextContent("今日 +1・7 日平均 +0.3/日");
    expect(screen.getByTestId("admin-stat-users")).toHaveTextContent("24");
    expect(screen.getByTestId("admin-stat-paidCouples")).toHaveTextContent("プレミアム");
    expect(screen.getByTestId("admin-stat-posts")).toBeTruthy();
    expect(screen.getByTestId("admin-stat-images")).toBeTruthy();
    expect(await screen.findByTestId("admin-actions-empty")).toBeTruthy();
    expect(setOptionsMock).toHaveBeenCalledWith({ title: "運営" });
  });

  it("探す → 利用者とペアの箱（数とプランの行）→「プレミアムにする」→ 確認 →「変更」→ setPlan → 直近の操作に出る", async () => {
    renderIn(<AdminScreen />);
    await screen.findByTestId("admin-stat-couples");
    // 探す前はボタンが押せない
    expect(screen.getByTestId("admin-lookup-submit").getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(screen.getByTestId("admin-lookup-email"), { target: { value: " yui@example.com " } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("admin-lookup-submit"));
    });
    expect(lookupMock).toHaveBeenCalledWith({ email: "yui@example.com" }, expect.anything());
    expect(await screen.findByTestId("admin-lookup-user")).toHaveTextContent("yui@example.com");
    expect(screen.getByTestId("admin-lookup-user")).toHaveTextContent("5 件");
    expect(screen.getByTestId("admin-lookup-user")).toHaveTextContent("7 枚");
    expect(screen.getByTestId("admin-couple-plan")).toHaveTextContent("無料");
    expect(screen.getByTestId("admin-couple-source")).toHaveTextContent("行なし");
    expect(screen.getByTestId("admin-lookup-couple")).toHaveTextContent("2 人");
    expect(screen.getByTestId("admin-lookup-couple")).toHaveTextContent("20 枚");
    // ペアの id は画面に出さない（setPlan に渡すだけ）
    expect(screen.queryByText(/couple-abcdef12/)).toBeNull();

    // 切り替え → 確認
    lookupMock.mockResolvedValue(lookupResult({ plan: "paid", source: "manual" }));
    actionsMock.mockResolvedValue({
      items: [
        {
          id: "a1",
          adminEmail: "admin@example.com",
          action: "plan.set",
          coupleId: "couple-abcdef12",
          detail: JSON.stringify({ from: null, to: { plan: "paid", source: "manual", expiresAt: null } }),
          createdAt: NOW,
        },
      ],
    });
    fireEvent.click(screen.getByTestId("admin-set-paid"));
    expect(await screen.findByTestId("admin-confirm-text")).toHaveTextContent("yui@example.comのペアをプレミアムにします");
    expect(setPlanMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("admin-confirm"));
    });
    await waitFor(() => expect(setPlanMock).toHaveBeenCalledWith({ coupleId: "couple-abcdef12", plan: "paid" }, expect.anything()));
    await waitFor(() => expect(screen.getByTestId("admin-couple-plan")).toHaveTextContent("プレミアム"));
    expect(await screen.findByTestId("admin-notice")).toHaveTextContent("プレミアムにしました");
    expect(screen.getByTestId("admin-set-free")).toBeTruthy();
    expect(await screen.findByTestId("admin-action-a1")).toHaveTextContent("plan.set・couple-a・（行なし） → プレミアム");
    expect(screen.getByTestId("admin-action-a1")).toHaveTextContent("admin@example.com");
  });

  it("source='stripe' のペアはボタンが無く「Stripe で管理（Portal）」の 1 行。見つからなければ「見つかりません」", async () => {
    lookupMock.mockResolvedValue(lookupResult({ plan: "paid", source: "stripe", hasStripeCustomer: true, expiresAt: NOW + 86400 * 20 }));
    renderIn(<AdminScreen />);
    await screen.findByTestId("admin-stat-couples");
    fireEvent.change(screen.getByTestId("admin-lookup-email"), { target: { value: "yui@example.com" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("admin-lookup-submit"));
    });
    expect(await screen.findByTestId("admin-couple-stripe")).toHaveTextContent("Stripe で管理（Portal）");
    expect(screen.queryByTestId("admin-set-paid")).toBeNull();
    expect(screen.queryByTestId("admin-set-free")).toBeNull();
    expect(screen.getByTestId("admin-couple-source")).toHaveTextContent("stripe");

    lookupMock.mockResolvedValue({ user: null, couple: null });
    fireEvent.change(screen.getByTestId("admin-lookup-email"), { target: { value: "nobody@example.com" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("admin-lookup-submit"));
    });
    expect(await screen.findByTestId("admin-lookup-none")).toHaveTextContent("見つかりません");
    expect(screen.queryByTestId("admin-lookup-user")).toBeNull();
  });

  it("未所属の利用者: ペアの箱は「ペアに所属していません」", async () => {
    lookupMock.mockResolvedValue({ ...lookupResult(), couple: null });
    renderIn(<AdminScreen />);
    await screen.findByTestId("admin-stat-couples");
    fireEvent.change(screen.getByTestId("admin-lookup-email"), { target: { value: "yui@example.com" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("admin-lookup-submit"));
    });
    expect(await screen.findByTestId("admin-couple-none")).toBeTruthy();
  });
});

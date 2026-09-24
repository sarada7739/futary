import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 「コードで参加する」で参加したら (tabs) へ進む（(onboarding) に戻らない）。
// join.tsx の handleSubmit が viewerKey を含まないキーへ setQueryData すると、_layout.tsx の coupleQuery
// （`[...queryKey, viewerKey]`。T9）とは別の枠に書くだけになり、ルートの guard（hasCouple・
// needsOnboarding）に反映されず (onboarding) へ差し戻される。
// 実際のナビゲータの解決（Stack.Protected の guard が hasCouple へ切り替わるか）まで含めて固定する。
// expo-router の実ルーティングはテスト環境で解決できないので、Stack・Stack.Screen・Stack.Protected を
// 最小のダミーにし、(onboarding) の位置に実際の JoinCoupleScreen を置く
// （root-navigator-guest-resolves.test.tsx と同じ形）

const { coupleGetMock, inviteAcceptMock, replaceMock } = vi.hoisted(() => ({
  coupleGetMock: vi.fn(),
  inviteAcceptMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("expo-router", () => {
  function Stack({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  Stack.Protected = function StackProtected({ guard, children }: { guard: boolean; children: ReactNode }) {
    return guard ? <>{children}</> : null;
  };
  Stack.Screen = function StackScreen({ name }: { name: string }) {
    if (name === "(tabs)") return <div data-testid="screen-tabs">tabs</div>;
    if (name === "(onboarding)") return <OnboardingStub />;
    if (name === "(auth)") return <div data-testid="screen-auth">auth</div>;
    return null;
  };
  return { Stack, useRouter: () => ({ replace: replaceMock }) };
});

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { couple: { get: coupleGetMock }, invite: { accept: inviteAcceptMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "me", name: "自分", email: "me@example.com", image: null } },
    isPending: false,
  }),
}));

const { default: RootLayout } = await import("../app/_layout");
const { default: JoinCoupleScreen } = await import("../app/(onboarding)/join");
const { queryClient } = await import("../lib/query");

// (onboarding) 配下の実ルーティングは解決できないので、join.tsx を直接置く
function OnboardingStub() {
  return <JoinCoupleScreen />;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

describe("招待コードで参加すると(tabs)へ進む（コード入力後に再び参加画面へ戻る不具合の回帰）", () => {
  it("参加後、couple.getの再取得でhasCoupleがtrueになり(tabs)が表示される", async () => {
    // 最初はペア未所属（NEEDS_ONBOARDING）
    coupleGetMock.mockRejectedValueOnce(new ORPCError("NEEDS_ONBOARDING", { defined: true }));

    render(<RootLayout />);

    expect(await screen.findByText("招待コードを入力してください")).toBeInTheDocument();

    const couple = { id: "couple-1", datingDate: null, marriedDate: null, primaryDate: "unset" as const };
    inviteAcceptMock.mockResolvedValue(couple);
    // handleSubmit の invalidateQueries による再取得。今度はペアに参加済み
    coupleGetMock.mockResolvedValueOnce(couple);

    const input = screen.getByPlaceholderText("6桁のコード");
    fireEvent.change(input, { target: { value: "ABCDEF" } });
    await act(async () => {
      fireEvent.click(screen.getByText("参加する"));
      await Promise.resolve();
    });

    await waitFor(() => expect(inviteAcceptMock).toHaveBeenCalledWith({ code: "ABCDEF" }, expect.anything()));

    // 決着していれば(tabs)画面が出て、参加画面（(onboarding)）はもう出ない
    await waitFor(() => {
      expect(screen.getByTestId("screen-tabs")).toBeInTheDocument();
    });
    expect(screen.queryByText("招待コードを入力してください")).not.toBeInTheDocument();
  });
});

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 不具合の回帰テスト（2026-09-02、人間の実機報告）。
// 「コードで参加する」で招待コードを入力して参加すると、(tabs)へ進まず
// 再び「コードで参加する」画面（(onboarding)）に戻ってしまっていた。
//
// 真因: apps/app/app/(onboarding)/join.tsxのhandleSubmitが
// `queryClient.setQueryData(orpc.couple.get.queryKey(), couple)`と、
// viewerKeyを含まないキーへ書き込んでいた。_layout.tsxのcoupleQueryは
// `[...orpc.couple.get.queryOptions().queryKey, viewerKey]`というキーで
// 読んでいる（T9。apps/app/lib/viewer-key.ts）ため、このsetQueryDataは
// 実際には別のキャッシュ枠に書き込むだけで、ルートのガード
// （hasCouple/needsOnboarding）が見ているデータには一切反映されず、
// router.replace("/")してもcouple.get未所属のまま(onboarding)へ
// 差し戻されていた。
//
// viewer-key-coverage.test.tsの走査は`orpc.<namespace>.<method>.
// (queryOptions|infiniteOptions)(`という呼び出しパターンしか見ないため、
// setQueryDataによる直接書き込みは検出対象外だった（025のpendingInvite
// QueryKeyと同じ形の見落とし）。
//
// root-navigator-guest-resolves.test.tsxと同じ形で、実際のナビゲータ
// 解決（Stack.ProtectedのguardがhasCoupleへ切り替わるか）まで含めて
// 固定する。expo-routerの実ルーティングはテスト環境で解決できないため、
// Stack・Stack.Screen・Stack.Protectedを最小限のダミーに差し替え、
// (onboarding)の位置に実際のJoinCoupleScreenを置く

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

// (onboarding)配下のexpo-router実ルーティングは解決できないため、
// 「コードで参加する」画面（join.tsx）を直接置く
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
    // handleSubmit内のinvalidateQueriesによる再取得。今度はペアに参加済み
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

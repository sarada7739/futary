import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGuestMode } from "../lib/guest-mode";

// 識別が変わった後（ゲストではじめる）、couple.get が決着する（fetchStatus:"fetching" のまま止まらない）
// ことを固定する。_layout.tsx の識別変化のエフェクトが queryClient.clear() を呼ぶと、新しい viewerKey で
// 発火したばかりの問い合わせがキャッシュごと消え、retry:false のため読み込み中のまま止まる。
// expo-router の実ルーティングはテスト環境で解決できないので、Stack・Stack.Screen・Stack.Protected を
// 最小のダミーにし、(auth) の位置に「ゲストではじめる」相当のボタンを直接置く

const { coupleGetMock } = vi.hoisted(() => ({
  coupleGetMock: vi.fn(),
}));

vi.mock("expo-router", () => {
  function Stack({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  Stack.Protected = function StackProtected({ guard, children }: { guard: boolean; children: ReactNode }) {
    return guard ? <>{children}</> : null;
  };
  Stack.Screen = function StackScreen({ name }: { name: string }) {
    if (name === "(auth)") return <AuthScreenStub />;
    if (name === "(tabs)") return <div data-testid="screen-tabs">tabs</div>;
    if (name === "compose") return <div data-testid="screen-compose">compose</div>;
    if (name === "(onboarding)") return <div data-testid="screen-onboarding">onboarding</div>;
    return null;
  };
  return { Stack };
});

// 実際の(auth)/sign-in.tsxの「ゲストではじめる」ボタンと同じく、
// useGuestMode()のenterGuestModeをそのまま呼ぶ
function AuthScreenStub() {
  const { enterGuestMode } = useGuestMode();
  return (
    <button type="button" onClick={enterGuestMode}>
      ゲストではじめる
    </button>
  );
}

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { couple: { get: coupleGetMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

// _layout.tsx も useSession を参照する。本物の auth-client.ts は expo-secure-store 等を読み jsdom で落ちるのでモックする
vi.mock("../lib/auth-client", () => ({
  useSession: () => ({ data: null, isPending: false }),
}));

const { default: RootLayout } = await import("../app/_layout");
const { queryClient } = await import("../lib/query");

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

describe("識別がゲストへ変わった後、couple.getが決着する", () => {
  it("couple.getの解決が遅れても、識別変化のエフェクトに消されず最終的にhasCoupleへ届く", async () => {
    let resolveCouple: (value: unknown) => void = () => {};
    coupleGetMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCouple = resolve;
        }),
    );

    render(<RootLayout />);

    fireEvent.click(screen.getByText("ゲストではじめる"));

    // 識別が変わった直後は読み込み中のオーバーレイが出る
    expect(await screen.findByText("読み込み中…")).toBeInTheDocument();

    // couple.get を解決させる。識別変化のエフェクトが先に queryClient.clear() を呼んでいると、ここで
    // 解決しても画面には反映されない（fetchStatus:"fetching" のまま止まる）
    await act(async () => {
      resolveCouple({ id: "demo-couple", datingDate: "2025-01-01", marriedDate: null, primaryDate: "dating" });
    });

    // 決着していれば(tabs)画面が出て、読み込み中は消える
    await waitFor(() => {
      expect(screen.getByTestId("screen-tabs")).toBeInTheDocument();
    });
    expect(screen.queryByText("読み込み中…")).not.toBeInTheDocument();
  });
});

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGuestMode } from "../lib/guest-mode";

// PR #177で踏んだ不具合の回帰テスト。「ゲストではじめる→/composeに飛んで
// 読み込み中のまま止まる」の真因は、apps/app/app/_layout.tsxの識別変化
// エフェクトが呼んでいた`queryClient.clear()`だった。couple.getが新しい
// viewerKeyで発火した直後にこれが走ると、発火したばかりの問い合わせが
// キャッシュごと消され、`retry:false`のため二度と再試行されず
// `fetchStatus:"fetching"`のまま永久に止まる（worklog.md 2026-09-01参照）。
//
// このテストは実際のナビゲータ解決（(auth)/(tabs)/composeのどれが
// 画面に出るか。Rレビュー指摘R-1）ではなく、「識別が変わった後、
// couple.getが決着する（fetchStatus:"fetching"のまま止まらない）」こと
// だけを狙って固定する（Rレビュー指摘R-2）。expo-routerの実ルーティングは
// テスト環境でファイルベースの解決ができないため、Stack・Stack.Screen・
// Stack.Protectedを最小限のダミーに差し替え、代わりに(auth)グループの
// 位置に「ゲストではじめる」相当のボタンを直接置く

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

// _layout.tsx自身もuseSessionを参照する。他の画面結合テストと同じ理由で
// auth-client.tsをモックする（本物を読み込むとexpo-secure-store等が
// jsdom環境でクラッシュする）
vi.mock("../lib/auth-client", () => ({
  useSession: () => ({ data: null, isPending: false }),
}));

const { default: RootLayout } = await import("../app/_layout");
const { queryClient } = await import("../lib/query");

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

describe("識別がゲストへ変わった後、couple.getが決着する（PR #177回帰）", () => {
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

    // couple.getを解決させる。旧コードでは、この時点で識別変化の
    // エフェクトがqueryClient.clear()を先に呼んでおり、発火したばかりの
    // 問い合わせがキャッシュごと消されているため、ここで解決しても
    // 画面には二度と反映されない（fetchStatus:"fetching"のまま止まる）
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

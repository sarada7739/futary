import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGuestMode } from "../lib/guest-mode";

// 056 T2〜T4: LP のスマホの枠（iframe）の中のデモ。
// - `/app/?demo=1` で開いたらサインイン画面を経ずにゲストモード（T2）。認証済みなら無視（T3）
// - 框の中（window.top !== window.self）で showAuth が立ったら親ページを /app/ に飛ばす（T4）
// root-navigator-guest-resolves.test.tsx と同じく、expo-router の Stack を最小限のダミーに差し替える

const { coupleGetMock, sessionState, frameState } = vi.hoisted(() => ({
  coupleGetMock: vi.fn(),
  sessionState: { data: null as null | { user: { id: string } } },
  // window.top の差し替え（jsdom では top === self。框の中を作るには top を別物にする）
  frameState: { assign: vi.fn() },
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
    if (name === "(tabs)") return <TabsStub />;
    if (name === "compose") return null;
    if (name === "(onboarding)") return <div data-testid="screen-onboarding">onboarding</div>;
    return null;
  };
  return { Stack };
});

function AuthScreenStub() {
  const { enterGuestMode } = useGuestMode();
  return (
    <button type="button" data-testid="screen-auth" onClick={enterGuestMode}>
      ゲストではじめる
    </button>
  );
}

// (tabs) の位置に、デモの帯の「ログイン」相当（exitGuestMode をそのまま呼ぶ）を置く
function TabsStub() {
  const { isGuestMode, exitGuestMode } = useGuestMode();
  return (
    <div data-testid="screen-tabs">
      <span data-testid="tabs-guest">{isGuestMode ? "guest" : "member"}</span>
      <button type="button" data-testid="tabs-logout" onClick={exitGuestMode}>
        ログイン
      </button>
    </div>
  );
}

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { couple: { get: coupleGetMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({ data: sessionState.data, isPending: false }),
}));

const { default: RootLayout } = await import("../app/_layout");
const { queryClient } = await import("../lib/query");
const { frameCredentials, isDemoEntry, isInFrame, leaveFrameToApp } = await import("../lib/demo-frame");

function setSearch(search: string) {
  window.history.replaceState(null, "", `/app/${search}`);
}

// 框の中を作る: window.top を「self と違う、location.assign を持つもの」に差し替える
const originalTop = Object.getOwnPropertyDescriptor(window, "top");
function enterFrame() {
  Object.defineProperty(window, "top", {
    configurable: true,
    get: () => ({ location: { assign: frameState.assign } }),
  });
}
function leaveFrame() {
  if (originalTop) Object.defineProperty(window, "top", originalTop);
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  sessionState.data = null;
  setSearch("");
  coupleGetMock.mockResolvedValue({ id: "demo-couple", datingDate: "2025-01-01", marriedDate: null, primaryDate: "dating" });
});

afterEach(() => {
  leaveFrame();
});

describe("lib/demo-frame（純関数）", () => {
  it("isDemoEntry: ?demo=1 だけ true。無し・demo=0・他のキーは false。window が無ければ false", () => {
    expect(isDemoEntry("?demo=1")).toBe(true);
    expect(isDemoEntry("?x=1&demo=1")).toBe(true);
    expect(isDemoEntry("")).toBe(false);
    expect(isDemoEntry("?demo=0")).toBe(false);
    expect(isDemoEntry("?demo")).toBe(false);
    expect(isDemoEntry(undefined)).toBe(false);
  });

  it("isInFrame: top === self なら false。違えば true。top に触れなければ true。window が無ければ false", () => {
    const self = {};
    expect(isInFrame({ top: self, self })).toBe(false);
    expect(isInFrame({ top: {}, self })).toBe(true);
    const throwing = {
      get top(): unknown {
        throw new Error("cross-origin");
      },
      self,
    };
    expect(isInFrame(throwing)).toBe(true);
    expect(isInFrame(undefined)).toBe(false);
  });

  it("leaveFrameToApp: top.location.assign('/app/') を呼ぶ。触れなければ何もしない", () => {
    const assign = vi.fn();
    leaveFrameToApp({ top: { location: { assign } } } as unknown as Window);
    expect(assign).toHaveBeenCalledWith("/app/");
    expect(() =>
      leaveFrameToApp({
        get top(): Window {
          throw new Error("cross-origin");
        },
      } as unknown as Window),
    ).not.toThrow();
  });
});

describe("056 T3b: 框の中では Cookie を送らない（frameCredentials）", () => {
  it("框の外は include。框の中は omit（orpc.ts の fetch は orpc-frame-credentials.test.ts で本物を見る）", () => {
    expect(frameCredentials()).toBe("include");
    enterFrame();
    expect(frameCredentials()).toBe("omit");
  });
});

describe("056 T2・T3: ?demo=1 の入口", () => {
  it("T2: 未認証で ?demo=1 → サインイン画面を出さず、デモ（ゲスト）の (tabs) が出る", async () => {
    setSearch("?demo=1");
    render(<RootLayout />);
    await waitFor(() => expect(screen.getByTestId("screen-tabs")).toBeInTheDocument());
    expect(screen.getByTestId("tabs-guest")).toHaveTextContent("guest");
    expect(screen.queryByTestId("screen-auth")).toBeNull();
    expect(coupleGetMock).toHaveBeenCalled();
  });

  it("T2: ?demo=1 が無ければ今まで通りサインイン画面", async () => {
    render(<RootLayout />);
    expect(await screen.findByTestId("screen-auth")).toBeInTheDocument();
    expect(screen.queryByTestId("screen-tabs")).toBeNull();
    expect(coupleGetMock).not.toHaveBeenCalled();
  });

  it("T3: 認証済みで ?demo=1 → 自分のペア（ゲストにならない）", async () => {
    setSearch("?demo=1");
    sessionState.data = { user: { id: "me" } };
    coupleGetMock.mockResolvedValue({ id: "couple-1", datingDate: "2024-04-06", marriedDate: null, primaryDate: "dating" });
    render(<RootLayout />);
    await waitFor(() => expect(screen.getByTestId("screen-tabs")).toBeInTheDocument());
    expect(screen.getByTestId("tabs-guest")).toHaveTextContent("member");
  });
});

describe("056 T4: 框の中ではサインイン画面の代わりに親ページを /app/ へ", () => {
  it("框の中で exitGuestMode → window.top.location.assign('/app/')。サインイン画面は出ない", async () => {
    setSearch("?demo=1");
    enterFrame();
    render(<RootLayout />);
    await waitFor(() => expect(screen.getByTestId("screen-tabs")).toBeInTheDocument());
    expect(frameState.assign).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId("tabs-logout"));
    });
    await waitFor(() => expect(frameState.assign).toHaveBeenCalledWith("/app/"));
    expect(frameState.assign).toHaveBeenCalledTimes(1);
  });

  it("0節 #3b: 框の中で ?demo=1 無しに開くと、サインイン画面を出さず「デモを読み込めませんでした」+「アプリを開く」（target=_top）。親は飛ばさない", async () => {
    enterFrame();
    render(<RootLayout />);
    expect(await screen.findByTestId("frame-fallback")).toHaveTextContent("デモを読み込めませんでした");
    const open = screen.getByTestId("frame-fallback-open");
    expect(open).toHaveTextContent("アプリを開く");
    expect(open.getAttribute("href")).toBe("/app/");
    expect(open.getAttribute("target")).toBe("_top");
    expect(screen.queryByTestId("screen-auth")).toBeNull();
    expect(frameState.assign).not.toHaveBeenCalled();
  });

  it("T4b: 框の中で ?demo=1 → couple.get が失敗（demoFailed）→ 親は飛ばない。サインイン画面は出ず、1 行と「アプリを開く」。框の外の失敗は今まで通りサインイン画面", async () => {
    setSearch("?demo=1");
    coupleGetMock.mockRejectedValue(new Error("network"));
    enterFrame();
    const inFrameRender = render(<RootLayout />);
    expect(await screen.findByTestId("frame-fallback")).toHaveTextContent("デモを読み込めませんでした");
    expect(screen.getByTestId("frame-fallback-open").getAttribute("target")).toBe("_top");
    expect(screen.queryByTestId("screen-auth")).toBeNull();
    expect(screen.queryByTestId("screen-tabs")).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(frameState.assign).not.toHaveBeenCalled();

    // 框の外: サインイン画面（demoUnavailable の 1 行は sign-in.tsx。ここでは (auth) が出ることだけ）
    inFrameRender.unmount();
    leaveFrame();
    queryClient.clear();
    render(<RootLayout />);
    expect(await screen.findByTestId("screen-auth")).toBeInTheDocument();
    expect(screen.queryByTestId("frame-fallback")).toBeNull();
    expect(frameState.assign).not.toHaveBeenCalled();
  });

  it("T3b: 框の中でセッションが見えても（Cookie が漏れた場合の二重の守り）isAuthenticated は false で、デモペアのまま", async () => {
    setSearch("?demo=1");
    sessionState.data = { user: { id: "me" } };
    enterFrame();
    render(<RootLayout />);
    await waitFor(() => expect(screen.getByTestId("screen-tabs")).toBeInTheDocument());
    expect(screen.getByTestId("tabs-guest")).toHaveTextContent("guest");
    expect(frameState.assign).not.toHaveBeenCalled();
  });

  it("框の外では今まで通りサインイン画面（assign は呼ばれない）", async () => {
    setSearch("?demo=1");
    render(<RootLayout />);
    await waitFor(() => expect(screen.getByTestId("screen-tabs")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByTestId("tabs-logout"));
    });
    expect(await screen.findByTestId("screen-auth")).toBeInTheDocument();
    expect(frameState.assign).not.toHaveBeenCalled();
  });
});

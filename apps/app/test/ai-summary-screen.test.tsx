import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// AI まとめ画面の結合テスト（037）。oRPC クライアントは mood-screen.test.tsx と同じ形でモックする
const { meGetMock, getMock, generateMock, pushMock } = vi.hoisted(() => ({
  meGetMock: vi.fn(),
  getMock: vi.fn(),
  generateMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// useViewerQueryKey が auth-client 経由で useSession を参照するのでモックする
vi.mock("../lib/auth-client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    me: { get: meGetMock },
    aiSummary: { get: getMock, generate: generateMock },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: AiSummaryScreen } = await import("../app/(tabs)/ai-summary");
const { queryClient } = await import("../lib/query");
const { GuestModeContext } = await import("../lib/guest-mode");

function makeMe(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "me",
    name: "自分",
    email: "me@example.com",
    image: null,
    aiOptIn: false,
    partnerAiOptIn: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  meGetMock.mockResolvedValue(makeMe());
  getMock.mockResolvedValue(null);
});

function renderScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AiSummaryScreen />
    </QueryClientProvider>,
  );
}

function renderScreenAsGuest() {
  return render(
    <QueryClientProvider client={queryClient}>
      <GuestModeContext.Provider
        value={{ isGuestMode: true, enterGuestMode: () => {}, exitGuestMode: vi.fn(), demoUnavailable: false }}
      >
        <AiSummaryScreen />
      </GuestModeContext.Provider>
    </QueryClientProvider>,
  );
}

describe("AiSummaryScreen: 同意の状態", () => {
  it("自分が同意していないとき、マイページへの導線が出て生成ボタンは出ない", async () => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: false }));

    renderScreen();

    expect(await screen.findByText(/マイページで同意してください/)).toBeTruthy();
    expect(screen.queryByText("まとめを作る")).toBeNull();
  });

  it("マイページへの導線を押すと/profileへ遷移する", async () => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: false }));

    renderScreen();
    fireEvent.click(await screen.findByText("マイページへ"));

    expect(pushMock).toHaveBeenCalledWith("/profile");
  });

  it("自分は同意済みだが相手が未同意のとき、相手の同意を待つ表示になる", async () => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: true, partnerAiOptIn: false }));

    renderScreen();

    expect(await screen.findByText("相手の同意を待っています")).toBeTruthy();
    expect(screen.queryByText("まとめを作る")).toBeNull();
  });

  it("2人とも同意していれば「まとめを作る」ボタンが出る", async () => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: true, partnerAiOptIn: true }));

    renderScreen();

    expect(await screen.findByText("まとめを作る")).toBeTruthy();
  });
});

describe("AiSummaryScreen: 生成", () => {
  beforeEach(() => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: true, partnerAiOptIn: true }));
  });

  it("生成に成功すると本文とprovider/modelが表示される", async () => {
    const generated = {
      body: "楽しい1ヶ月でした",
      provider: "openai" as const,
      model: "gpt-4o-mini",
      updatedAt: 0,
      generatedCount: 1,
    };
    generateMock.mockResolvedValue(generated);
    // 生成後に aiSummary.get のキャッシュを無効化して再取得する。初回は null、生成後の再取得では
    // generated を返す
    getMock.mockResolvedValueOnce(null).mockResolvedValue(generated);

    renderScreen();
    fireEvent.click(await screen.findByText("まとめを作る"));

    expect(await screen.findByText("楽しい1ヶ月でした")).toBeTruthy();
    expect(await screen.findByText("openai / gpt-4o-mini")).toBeTruthy();
  });

  it("投稿3件未満でINVALID_INPUTが返ると専用の文言が出る", async () => {
    generateMock.mockRejectedValue(new ORPCError("INVALID_INPUT"));

    renderScreen();
    fireEvent.click(await screen.findByText("まとめを作る"));

    expect(await screen.findByText("この月はまだ投稿が3件に届いていません")).toBeTruthy();
  });

  it("LIMIT_REACHEDが返ると専用の文言が出る", async () => {
    generateMock.mockRejectedValue(new ORPCError("LIMIT_REACHED"));

    renderScreen();
    fireEvent.click(await screen.findByText("まとめを作る"));

    expect(await screen.findByText("もう作り直せません（期間ごと3回・1ヶ月合計10回まで）")).toBeTruthy();
  });

  it("生成済みで3回使い切っているときは作り直すボタンが出ない", async () => {
    getMock.mockResolvedValue({
      body: "まとめ本文",
      provider: "openai",
      model: "gpt-4o-mini",
      updatedAt: 0,
      generatedCount: 3,
    });

    renderScreen();

    await screen.findByText("まとめ本文");
    expect(screen.getByText("この月は3回使い切りました")).toBeTruthy();
    expect(screen.queryByText("作り直す")).toBeNull();
  });

  it("生成済みで残り回数があれば作り直すボタンが出る", async () => {
    getMock.mockResolvedValue({
      body: "まとめ本文",
      provider: "openai",
      model: "gpt-4o-mini",
      updatedAt: 0,
      generatedCount: 1,
    });

    renderScreen();

    expect(await screen.findByText("作り直す")).toBeTruthy();
  });

  it("生成済みでも相手が未同意なら作り直すボタンは出ない", async () => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: true, partnerAiOptIn: false }));
    getMock.mockResolvedValue({
      body: "まとめ本文",
      provider: "openai",
      model: "gpt-4o-mini",
      updatedAt: 0,
      generatedCount: 1,
    });

    renderScreen();

    await screen.findByText("まとめ本文");
    expect(screen.getByText("相手の同意を待っています")).toBeTruthy();
    expect(screen.queryByText("作り直す")).toBeNull();
  });
});

describe("AiSummaryScreen: ゲスト（デモ）", () => {
  it("シードのまとめがあれば表示し、ログイン導線が出る（生成ボタンは出ない）", async () => {
    getMock.mockResolvedValue({
      body: "デモ用のまとめ本文",
      provider: "openai",
      model: "gpt-4o-mini",
      updatedAt: 0,
      generatedCount: 1,
    });

    renderScreenAsGuest();

    expect(await screen.findByText("デモ用のまとめ本文")).toBeTruthy();
    expect(await screen.findByText("まとめを作るにはログインしてください")).toBeTruthy();
    expect(screen.queryByText("まとめを作る")).toBeNull();
    expect(screen.queryByText("作り直す")).toBeNull();
  });

  it("まとめが無ければその旨が出る", async () => {
    getMock.mockResolvedValue(null);

    renderScreenAsGuest();

    expect(await screen.findByText("この月のまとめはまだありません")).toBeTruthy();
  });
});

describe("AiSummaryScreen: 期間の移動と月/週の切り替え", () => {
  // 既定は先月。前月へ移動してから翌月で元へ戻す形で、両方向のボタンを確かめる（前月だけだと翌月
  // ボタンは一度も通らない）
  it("前月・翌月ボタンで表示される月が変わる（両方とも押す）", async () => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: true, partnerAiOptIn: true }));

    renderScreen();
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    const first = getMock.mock.calls.at(-1)?.[0] as { periodKind: string; periodKey: string };
    expect(first.periodKind).toBe("month");

    fireEvent.click(screen.getByLabelText("前月"));
    let afterPrev: { periodKind: string; periodKey: string } = first;
    await waitFor(() => {
      const latest = getMock.mock.calls.at(-1)?.[0] as { periodKind: string; periodKey: string };
      expect(latest.periodKey).not.toBe(first.periodKey);
      afterPrev = latest;
    });

    // 翌月ボタンで最初の（先月の）periodKey へ戻る。既定の先月では翌月ボタンはまだ押せる
    fireEvent.click(screen.getByLabelText("翌月"));
    await waitFor(() => {
      const latest = getMock.mock.calls.at(-1)?.[0] as { periodKind: string; periodKey: string };
      expect(latest.periodKey).not.toBe(afterPrev.periodKey);
      expect(latest.periodKey).toBe(first.periodKey);
    });
  });

  // 既定の先月から翌月を押すと今月に入り、サーバが INVALID_INPUT で拒み続ける。今月へは進めないよう
  // ボタン自体を押せなくする（020「押せないボタンを置かない」）
  it("既定（先月）表示では翌月ボタンが押せない（今月へは進めない）", async () => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: true, partnerAiOptIn: true }));

    renderScreen();
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    const callCountBefore = getMock.mock.calls.length;

    const nextButton = screen.getByLabelText("翌月");
    expect(nextButton.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(nextButton);
    // disabled な Pressable は onPress が発火しない。問い合わせ回数が増えない（今月へ進まない）ことで見る
    expect(getMock.mock.calls.length).toBe(callCountBefore);
  });

  it("「週」に切り替えるとperiodKindがweekになり、YYYY-Www形式のキーで問い合わせる", async () => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: true, partnerAiOptIn: true }));

    renderScreen();
    fireEvent.click(await screen.findByText("週"));

    await waitFor(() => {
      const latest = getMock.mock.calls.at(-1)?.[0] as { periodKind: string; periodKey: string };
      expect(latest.periodKind).toBe("week");
      expect(latest.periodKey).toMatch(/^\d{4}-W\d{2}$/);
    });
  });

  // 月と同じく、前週だけでなく翌週も押す
  it("週表示で前週・翌週ボタンを押すと表示される週が変わる（両方とも押す）", async () => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: true, partnerAiOptIn: true }));

    renderScreen();
    fireEvent.click(await screen.findByText("週"));
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    const first = getMock.mock.calls.at(-1)?.[0] as { periodKind: string; periodKey: string };

    fireEvent.click(screen.getByLabelText("前週"));
    let afterPrev: { periodKind: string; periodKey: string } = first;
    await waitFor(() => {
      const latest = getMock.mock.calls.at(-1)?.[0] as { periodKind: string; periodKey: string };
      expect(latest.periodKey).not.toBe(first.periodKey);
      afterPrev = latest;
    });

    fireEvent.click(screen.getByLabelText("翌週"));
    await waitFor(() => {
      const latest = getMock.mock.calls.at(-1)?.[0] as { periodKind: string; periodKey: string };
      expect(latest.periodKey).not.toBe(afterPrev.periodKey);
      expect(latest.periodKey).toBe(first.periodKey);
    });
  });

  // 月と同じく、既定の先週から翌週を押すと今週に入る
  it("既定（先週）表示では翌週ボタンが押せない（今週へは進めない）", async () => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: true, partnerAiOptIn: true }));

    renderScreen();
    fireEvent.click(await screen.findByText("週"));
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    const callCountBefore = getMock.mock.calls.length;

    const nextButton = screen.getByLabelText("翌週");
    expect(nextButton.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(nextButton);
    expect(getMock.mock.calls.length).toBe(callCountBefore);
  });
});

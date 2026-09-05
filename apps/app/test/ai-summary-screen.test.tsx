import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 037: AIまとめ画面の結合テスト。mood-screen.test.tsxと同じ形でoRPCクライアントをモックする
const { meGetMock, getMock, generateMock, pushMock } = vi.hoisted(() => ({
  meGetMock: vi.fn(),
  getMock: vi.fn(),
  generateMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// useViewerQueryKey（apps/app/lib/viewer-key.ts）がauth-client経由でuseSessionを
// 参照する。expo-router等と同じ理由でモックする（home-screen.test.tsxと同じ形）
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
    // 生成後、aiSummary.getのキャッシュを無効化して再取得する（画面側の実装）。
    // 実際のサーバなら再取得結果が更新されているはずなので、テストでも
    // 初回はnull・生成後の再取得ではgeneratedを返すようにする
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
  // 【Rレビュー指摘R-3】このテストの題名は「前月・翌月ボタンで」なのに
  // 実際には前月しか押していなかった（conventions.md 6節「期待値と
  // 突き合わせるテストが見ないもの」）。既定が先月のため、翌月へ1回
  // 戻す（＝前月とは逆方向へ1回）操作を確かめないと、翌月ボタン自体は
  // 一度も検証されないまま緑になる。前月へ移動してから翌月で元へ戻す
  // 形で両方向を確かめる
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

    // 翌月ボタンで前月移動を打ち消し、最初の（先月の）periodKeyへ戻ることを
    // 確かめる。既定は先月＝翌月ボタンがまだ押せる位置なので、ここでは
    // 無効化されていない
    fireEvent.click(screen.getByLabelText("翌月"));
    await waitFor(() => {
      const latest = getMock.mock.calls.at(-1)?.[0] as { periodKind: string; periodKey: string };
      expect(latest.periodKey).not.toBe(afterPrev.periodKey);
      expect(latest.periodKey).toBe(first.periodKey);
    });
  });

  // 【Rレビュー指摘R-3の本題】既定の先月から翌月ボタンを1回押すと今月に
  // 入り、サーバがINVALID_INPUTで拒む→「読み込めませんでした」になる
  // （再試行しても今月を指定し続ける限り永久に失敗する）詰まりがあった。
  // エラーにする代わりに、そもそも今月へは進めないようボタン自体を
  // 押せなくする（020「押せないボタンを置かない」）
  it("既定（先月）表示では翌月ボタンが押せない（今月へは進めない）", async () => {
    meGetMock.mockResolvedValue(makeMe({ aiOptIn: true, partnerAiOptIn: true }));

    renderScreen();
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    const callCountBefore = getMock.mock.calls.length;

    const nextButton = screen.getByLabelText("翌月");
    expect(nextButton.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(nextButton);
    // disabledなPressableはonPressが発火しない。問い合わせ回数が
    // 増えていない（＝今月へ進まなかった）ことで確認する
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

  // 【Rレビュー指摘R-3】月と同じく、前週だけでなく翌週も押す
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

  // 月と同じ詰まりが週にもある（既定が先週のため、翌週ボタンを1回押すと
  // 今週に入りINVALID_INPUTになる）
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

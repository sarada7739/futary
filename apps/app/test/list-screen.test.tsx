import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 027: 行きたい場所・食べたいものリスト画面の結合テスト。timeline-screen.test.tsxと
// 同じ形でoRPCクライアントをモックする
const { listMock, createMock, setDoneMock, deleteMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  setDoneMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "me", name: "自分", email: "me@example.com", image: null } },
    isPending: false,
  }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    wish: {
      list: listMock,
      create: createMock,
      setDone: setDoneMock,
      delete: deleteMock,
    },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: ListScreen } = await import("../app/(tabs)/list");
const { queryClient } = await import("../lib/query");
const { GuestModeContext } = await import("../lib/guest-mode");

function makeWish(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "wish-1",
    title: "水族館に行く",
    doneAt: null,
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

function renderScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ListScreen />
    </QueryClientProvider>,
  );
}

describe("ListScreen: 表示", () => {
  it("一覧が表示される", async () => {
    listMock.mockResolvedValue({ items: [makeWish()] });

    renderScreen();

    expect(await screen.findByText("水族館に行く")).toBeTruthy();
  });

  it("空のとき「まだ何もありません」ではなく、何を入れる場所かを説明する文言が出る", async () => {
    listMock.mockResolvedValue({ items: [] });

    renderScreen();

    expect(await screen.findByText("行きたい場所や食べたいものを書き留めておけます")).toBeTruthy();
    expect(screen.queryByText("まだ何もありません")).toBeNull();
  });

  it(
    "取得に失敗すると再試行ボタンが出る",
    async () => {
      listMock.mockRejectedValue(new Error("network"));

      renderScreen();

      // 既定のリトライ（3回・指数バックオフ）が尽きるまでisErrorにならないため
      // 通常より長いタイムアウトを与える（calendar-screen.test.tsxと同じ理由）
      expect(await screen.findByText("読み込めませんでした", {}, { timeout: 10000 })).toBeTruthy();
      expect(screen.getByText("再試行")).toBeTruthy();
    },
    15000,
  );
});

describe("ListScreen: 追加", () => {
  it("入力して追加すると wish.create が呼ばれ、一覧に反映される", async () => {
    listMock.mockResolvedValueOnce({ items: [] });
    const created = makeWish({ id: "new-wish", title: "新しい行きたい場所" });
    createMock.mockResolvedValue(created);
    listMock.mockResolvedValueOnce({ items: [created] });

    renderScreen();
    expect(await screen.findByText("行きたい場所や食べたいものを書き留めておけます")).toBeTruthy();

    const input = screen.getByPlaceholderText("行きたい場所、食べたいもの…");
    fireEvent.change(input, { target: { value: "新しい行きたい場所" } });
    await act(async () => {
      fireEvent.click(screen.getByText("追加"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ title: "新しい行きたい場所" }), expect.anything()),
    );
    expect(await screen.findByText("新しい行きたい場所")).toBeTruthy();
  });

  it("空白だけの入力では追加ボタンが押せない", async () => {
    listMock.mockResolvedValue({ items: [] });

    renderScreen();
    const input = await screen.findByPlaceholderText("行きたい場所、食べたいもの…");
    fireEvent.change(input, { target: { value: "   " } });

    fireEvent.click(screen.getByText("追加"));
    expect(createMock).not.toHaveBeenCalled();
  });

  it("上限に達すると専用のメッセージが出る", async () => {
    listMock.mockResolvedValue({ items: [] });
    createMock.mockRejectedValue(new ORPCError("LIMIT_REACHED", { defined: true }));

    renderScreen();
    const input = await screen.findByPlaceholderText("行きたい場所、食べたいもの…");
    fireEvent.change(input, { target: { value: "201件目" } });
    await act(async () => {
      fireEvent.click(screen.getByText("追加"));
      await Promise.resolve();
    });

    expect(await screen.findByText("これ以上は追加できません")).toBeTruthy();
  });
});

describe("ListScreen: チェック・削除", () => {
  it("チェックを付けると wish.setDone が呼ばれ、消えずに下へ移る", async () => {
    const undone = makeWish({ id: "undone", title: "未達成", doneAt: null });
    const done = makeWish({ id: "done", title: "達成済み", doneAt: 100 });
    listMock.mockResolvedValueOnce({ items: [undone, done] });
    setDoneMock.mockResolvedValue({ ...undone, doneAt: 200 });
    listMock.mockResolvedValueOnce({ items: [done, { ...undone, doneAt: 200 }] });

    renderScreen();
    expect(await screen.findByText("未達成")).toBeTruthy();
    expect(screen.getByText("達成済み")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("達成済みにする"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(setDoneMock).toHaveBeenCalledWith({ id: "undone", done: true }, expect.anything()),
    );
    // 消えずに一覧に残っている（達成しても消えない。タスク定義2節）
    expect(await screen.findByText("未達成")).toBeTruthy();
  });

  it("チェックを外すと done:false で wish.setDone が呼ばれる", async () => {
    const done = makeWish({ id: "done", title: "達成済み", doneAt: 100 });
    listMock.mockResolvedValueOnce({ items: [done] });
    setDoneMock.mockResolvedValue({ ...done, doneAt: null });
    listMock.mockResolvedValueOnce({ items: [{ ...done, doneAt: null }] });

    renderScreen();
    expect(await screen.findByText("達成済み")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("達成済みを外す"));
      await Promise.resolve();
    });

    await waitFor(() => expect(setDoneMock).toHaveBeenCalledWith({ id: "done", done: false }, expect.anything()));
  });

  // post-card.tsxのDeleteMenuと同じ形。確認せず即削除しない
  it("「削除」→「削除する」の操作で wish.delete が呼ばれ、一覧から消える", async () => {
    const wish = makeWish({ id: "to-delete", title: "消される項目" });
    listMock.mockResolvedValueOnce({ items: [wish] });
    deleteMock.mockResolvedValue({ id: wish.id });
    listMock.mockResolvedValueOnce({ items: [] });

    renderScreen();
    expect(await screen.findByText("消される項目")).toBeTruthy();

    fireEvent.click(screen.getByText("削除"));
    await act(async () => {
      fireEvent.click(screen.getByText("削除する"));
      await Promise.resolve();
    });

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith({ id: wish.id }, expect.anything()));
    await waitFor(() => expect(screen.queryByText("消される項目")).toBeNull());
  });
});

// タスク定義11節の確認観点: ゲストで開いたとき、入力欄が押せる形で置かれていないか
describe("ListScreen: ゲスト閲覧", () => {
  it("入力欄・追加ボタンの代わりにログイン導線が出る。チェック・削除も押せない", async () => {
    listMock.mockResolvedValue({ items: [makeWish({ title: "デモの行きたい場所" })] });
    const exitGuestMode = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <GuestModeContext.Provider
          value={{ isGuestMode: true, enterGuestMode: vi.fn(), exitGuestMode, demoUnavailable: false }}
        >
          <ListScreen />
        </GuestModeContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("デモの行きたい場所")).toBeTruthy();
    expect(screen.queryByPlaceholderText("行きたい場所、食べたいもの…")).toBeNull();
    expect(screen.queryByText("追加")).toBeNull();
    expect(screen.queryByLabelText("達成済みにする")).toBeNull();
    expect(screen.queryByText("削除")).toBeNull();

    fireEvent.click(screen.getByText("ログイン"));
    expect(exitGuestMode).toHaveBeenCalled();
  });
});

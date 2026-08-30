import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@futary/contract";
import { todayJst } from "@futary/date";
import { monthGridRange } from "../lib/calendar";

// 011: カレンダー画面の画面結合テスト。home-timeline.test.tsx と同じ形で
// oRPC クライアントをモックする（サーバとの契約自体は検証しない。conventions.md 6節）
const { listMock, createMock, updateMock, deleteMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    event: {
      list: listMock,
      create: createMock,
      update: updateMock,
      delete: deleteMock,
    },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: CalendarScreen } = await import("../app/calendar");
const { queryClient } = await import("../lib/query");

const today = todayJst();
const [todayYear, todayMonth] = today.split("-").map(Number) as [number, number];
const { from: gridFrom } = monthGridRange(todayYear, todayMonth);

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "event-1",
    date: today,
    sourceDate: today,
    title: "テストイベント",
    kind: "plan",
    repeatYearly: false,
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
      <CalendarScreen />
    </QueryClientProvider>,
  );
}

describe("CalendarScreen", () => {
  it("今日の日付が選択された状態で、その日のイベントが一覧に出る", async () => {
    listMock.mockResolvedValue({ items: [makeEvent({ title: "デート" })] });

    renderScreen();

    expect(await screen.findByText("デート")).toBeTruthy();
    // 「予定」は凡例とイベント行の両方に出るため件数で確認する
    expect(screen.getAllByText("予定").length).toBeGreaterThanOrEqual(2);
  });

  it("イベントゼロの月では「予定はまだありません」が出る", async () => {
    listMock.mockResolvedValue({ items: [] });

    renderScreen();

    expect(await screen.findByText("予定はまだありません")).toBeTruthy();
  });

  it(
    "通信エラーで再試行ボタンが出る",
    async () => {
      listMock.mockRejectedValue(new Error("network"));

      renderScreen();

      // 既定のリトライ（3回・指数バックオフ）が尽きるまで isError にならないため
      // 通常より長いタイムアウトを与える
      expect(await screen.findByText("カレンダーを読み込めませんでした", {}, { timeout: 10000 })).toBeTruthy();
      expect(screen.getByText("再試行")).toBeTruthy();
    },
    15000,
  );

  it("前月・翌月にはみ出たグリッドのセルにイベントがあっても表示される（月の初日〜末日で取ると空になるバグの回帰）", async () => {
    // グリッド先頭（前月側にはみ出す日）に立てたイベント
    listMock.mockResolvedValue({ items: [makeEvent({ date: gridFrom, sourceDate: gridFrom, title: "前月側の予定" })] });

    renderScreen();
    await screen.findByTestId(`calendar-day-${gridFrom}`);

    fireEvent.click(screen.getByTestId(`calendar-day-${gridFrom}`));

    expect(await screen.findByText("前月側の予定")).toBeTruthy();
  });
});

describe("イベント登録 → カレンダーに現れる", () => {
  it("追加フォームから登録すると、選択日の一覧に反映される", async () => {
    listMock.mockResolvedValueOnce({ items: [] });
    const created = makeEvent({ id: "new-event", title: "新しい予定", kind: "meetup" });
    createMock.mockResolvedValue(created);
    listMock.mockResolvedValueOnce({ items: [created] });

    renderScreen();
    await screen.findByText("予定はまだありません");

    fireEvent.click(screen.getByTestId("calendar-add-event"));
    fireEvent.change(screen.getByTestId("event-form-title"), { target: { value: "新しい予定" } });
    fireEvent.click(screen.getByTestId("event-form-kind-meetup"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("event-form-submit"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ date: today, title: "新しい予定", kind: "meetup", repeatYearly: false }),
        expect.anything(),
      ),
    );
    expect(await screen.findByText("新しい予定")).toBeTruthy();
    // 「会った日」は凡例とイベント行の両方に出る
    expect(screen.getAllByText("会った日").length).toBeGreaterThanOrEqual(2);
  });

  it("記念日を選ぶと repeatYearly が自動で true になる", async () => {
    listMock.mockResolvedValueOnce({ items: [] });
    createMock.mockResolvedValue(makeEvent({ kind: "anniversary", repeatYearly: true }));
    listMock.mockResolvedValueOnce({ items: [makeEvent({ kind: "anniversary", repeatYearly: true })] });

    renderScreen();
    await screen.findByText("予定はまだありません");

    fireEvent.click(screen.getByTestId("calendar-add-event"));
    fireEvent.change(screen.getByTestId("event-form-title"), { target: { value: "テストイベント" } });
    fireEvent.click(screen.getByTestId("event-form-kind-anniversary"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("event-form-submit"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "anniversary", repeatYearly: true }),
        expect.anything(),
      ),
    );
  });
});

describe("編集は射影日ではなく登録日（sourceDate）を対象にする", () => {
  it("表示上の日付と登録日が異なる記念日を編集すると、sourceDate が送られる", async () => {
    // 2000年に登録された記念日が、今年の日付へ射影されて表示されているケース
    const projected = makeEvent({
      id: "anniversary-1",
      date: today,
      sourceDate: "2000-01-01",
      kind: "anniversary",
      repeatYearly: true,
      title: "記念日",
    });
    listMock.mockResolvedValue({ items: [projected] });
    updateMock.mockResolvedValue(projected);

    renderScreen();
    fireEvent.click(await screen.findByTestId(`event-row-${projected.id}-${projected.date}`));

    const dateInput = (await screen.findByTestId("event-form-date")) as HTMLInputElement;
    expect(dateInput.value).toBe("2000-01-01");

    await act(async () => {
      fireEvent.click(screen.getByTestId("event-form-submit"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: projected.id, date: "2000-01-01" }),
        expect.anything(),
      ),
    );
  });
});

describe("削除", () => {
  it("編集フォームの削除→確認で event.delete が呼ばれ、一覧から消える", async () => {
    const target = makeEvent({ id: "to-delete", title: "消えるイベント" });
    listMock.mockResolvedValueOnce({ items: [target] });
    deleteMock.mockResolvedValue({ id: target.id });
    listMock.mockResolvedValueOnce({ items: [] });

    renderScreen();
    fireEvent.click(await screen.findByTestId(`event-row-${target.id}-${target.date}`));

    fireEvent.click(await screen.findByTestId("event-form-delete"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("event-form-delete-confirm"));
      await Promise.resolve();
    });

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith({ id: target.id }, expect.anything()));
    await waitFor(() => expect(screen.queryByText("消えるイベント")).toBeNull());
  });
});

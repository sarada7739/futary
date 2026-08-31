import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
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

// useViewerQueryKey（apps/app/lib/viewer-key.ts）がauth-client経由でuseSessionを
// 参照する。本物のauth-client.tsを読み込むとexpo-secure-store等がロードされ
// jsdom環境でクラッシュするため、他のexpoパッケージ（home-timeline.test.tsx参照）と
// 同じ理由でモックする
vi.mock("../lib/auth-client", () => ({
  useSession: () => ({ data: null }),
}));

const { default: CalendarScreen } = await import("../app/(tabs)/calendar");
const { queryClient } = await import("../lib/query");
const { GuestModeContext } = await import("../lib/guest-mode");

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
    startTime: null,
    endTime: null,
    createdByName: null,
    isShared: false,
    canEdit: true,
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

function renderScreenAsGuest(exitGuestMode: () => void) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GuestModeContext.Provider value={{ isGuestMode: true, enterGuestMode: () => {}, exitGuestMode, demoUnavailable: false }}>
        <CalendarScreen />
      </GuestModeContext.Provider>
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

describe("018: 設定者の名前・時間・会った日の一意化", () => {
  it("予定に設定者の名前が表示される", async () => {
    listMock.mockResolvedValue({ items: [makeEvent({ title: "デート", createdByName: "たろう" })] });

    renderScreen();

    const row = await screen.findByTestId(`event-row-event-1-${today}`);
    expect(row.textContent).toContain("たろうが設定");
  });

  it("時間が設定されていれば、タイトルの前に添えて表示される", async () => {
    listMock.mockResolvedValue({ items: [makeEvent({ title: "デート", startTime: "18:30" })] });

    renderScreen();

    const row = await screen.findByTestId(`event-row-event-1-${today}`);
    expect(row.textContent).toContain("18:30");
    expect(row.textContent).toContain("デート");
  });

  it("開始と終了の両方が設定されていれば「12:00〜13:00」の形で表示される", async () => {
    listMock.mockResolvedValue({
      items: [makeEvent({ title: "デート", startTime: "12:00", endTime: "13:00" })],
    });

    renderScreen();

    const row = await screen.findByTestId(`event-row-event-1-${today}`);
    expect(row.textContent).toContain("12:00〜13:00");
  });
});

// 022・Aの決定: event.updateは部分更新ではなく全項目の置き換えのため、
// ホイールの初期化で丸められると触っていないのに書き換わる。刻みに乗らない
// 値は丸めず、選択肢の1行として差し込む形にした（docs/tasks/022-time-and-date-input.md）
describe("022: 刻みに乗らない時刻は丸めずに保存される", () => {
  it("12:07の予定をタイトルだけ変えて保存すると、startTimeが12:07のまま送られる", async () => {
    const existing = makeEvent({ id: "event-time-1", startTime: "12:07", title: "元のタイトル" });
    listMock.mockResolvedValue({ items: [existing] });
    updateMock.mockResolvedValue(existing);

    renderScreen();
    fireEvent.click(await screen.findByTestId(`event-row-${existing.id}-${existing.date}`));
    fireEvent.change(await screen.findByTestId("event-form-title"), { target: { value: "変更後のタイトル" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("event-form-submit"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: existing.id, title: "変更後のタイトル", startTime: "12:07" }),
        expect.anything(),
      ),
    );
  });

  it("記念日を選ぶと時間欄が隠れる（記念日には時間を設定できない）", async () => {
    listMock.mockResolvedValueOnce({ items: [] });
    renderScreen();
    await screen.findByText("予定はまだありません");

    fireEvent.click(screen.getByTestId("calendar-add-event"));
    expect(screen.getByTestId("event-form-add-start-time")).toBeTruthy();

    fireEvent.click(screen.getByTestId("event-form-kind-anniversary"));
    expect(screen.queryByTestId("event-form-add-start-time")).toBeNull();
  });

  it("既に会った日がある日付でmeetupを選ぶと上書きの注記が出るが、送信はブロックされない", async () => {
    const existing = makeEvent({ id: "existing-meetup", kind: "meetup", title: "水族館" });
    listMock.mockResolvedValue({ items: [existing] });
    createMock.mockResolvedValue(makeEvent({ id: "existing-meetup", kind: "meetup", title: "映画" }));

    renderScreen();
    await screen.findByText("水族館");

    fireEvent.click(screen.getByTestId("calendar-add-event"));
    fireEvent.change(screen.getByTestId("event-form-title"), { target: { value: "映画" } });
    fireEvent.click(screen.getByTestId("event-form-kind-meetup"));

    expect(await screen.findByText(/上書きされます/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId("event-form-submit"));
      await Promise.resolve();
    });
    expect(createMock).toHaveBeenCalled();
  });

  it("編集で既にmeetupがある日付へ変更しようとすると、注記が出て送信がブロックされる", async () => {
    const meetupA = makeEvent({ id: "meetup-a", date: "2026-01-01", sourceDate: "2026-01-01", kind: "meetup", title: "会った日A" });
    const meetupB = makeEvent({ id: "meetup-b", kind: "meetup", title: "会った日B" });
    listMock.mockResolvedValue({ items: [meetupA, meetupB] });

    renderScreen();
    fireEvent.click(await screen.findByTestId(`event-row-${meetupB.id}-${meetupB.date}`));
    fireEvent.change(await screen.findByTestId("event-form-date"), { target: { value: "2026-01-01" } });

    expect(await screen.findByText(/保存できません/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("event-form-submit"));
    await Promise.resolve();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("event.updateがINVALID_INPUTで失敗すると、会った日の重複専用のメッセージが出る", async () => {
    const target = makeEvent({ id: "to-update", title: "元のタイトル" });
    listMock.mockResolvedValue({ items: [target] });
    updateMock.mockRejectedValue(new ORPCError("INVALID_INPUT", { defined: true }));

    renderScreen();
    fireEvent.click(await screen.findByTestId(`event-row-${target.id}-${target.date}`));

    await act(async () => {
      fireEvent.click(screen.getByTestId("event-form-submit"));
      await Promise.resolve();
    });

    expect(
      await screen.findByText("その日には既に「会った日」が登録されています。日付を変えてください"),
    ).toBeTruthy();
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

// 021: 予定の持ち主・「ふたりの予定」
describe("021: 予定の持ち主・「ふたりの予定」", () => {
  it("種別が予定のときだけ「ふたりの予定にする」ボタンが出る", async () => {
    listMock.mockResolvedValue({ items: [] });
    renderScreen();
    await screen.findByText("予定はまだありません");

    fireEvent.click(screen.getByTestId("calendar-add-event"));
    // 既定はplanなので最初から出ている
    expect(screen.getByTestId("event-form-is-shared")).toBeTruthy();

    fireEvent.click(screen.getByTestId("event-form-kind-anniversary"));
    expect(screen.queryByTestId("event-form-is-shared")).toBeNull();

    fireEvent.click(screen.getByTestId("event-form-kind-plan"));
    expect(screen.getByTestId("event-form-is-shared")).toBeTruthy();
  });

  it("「ふたりの予定にする」をチェックして送信すると isShared:true で作成される", async () => {
    listMock.mockResolvedValueOnce({ items: [] });
    createMock.mockResolvedValue(makeEvent({ isShared: true }));
    listMock.mockResolvedValueOnce({ items: [makeEvent({ isShared: true })] });

    renderScreen();
    await screen.findByText("予定はまだありません");

    fireEvent.click(screen.getByTestId("calendar-add-event"));
    fireEvent.change(screen.getByTestId("event-form-title"), { target: { value: "ふたりの予定" } });
    fireEvent.click(screen.getByTestId("event-form-is-shared"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("event-form-submit"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ isShared: true }),
        expect.anything(),
      ),
    );
  });

  it("kindをplanから記念日に切り替えると、isSharedはfalseに戻って送信される", async () => {
    listMock.mockResolvedValueOnce({ items: [] });
    createMock.mockResolvedValue(makeEvent({ kind: "anniversary", repeatYearly: true }));
    listMock.mockResolvedValueOnce({ items: [] });

    renderScreen();
    await screen.findByText("予定はまだありません");

    fireEvent.click(screen.getByTestId("calendar-add-event"));
    fireEvent.change(screen.getByTestId("event-form-title"), { target: { value: "記念日" } });
    fireEvent.click(screen.getByTestId("event-form-is-shared"));
    fireEvent.click(screen.getByTestId("event-form-kind-anniversary"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("event-form-submit"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ isShared: false }),
        expect.anything(),
      ),
    );
  });

  it("canEdit:false のイベントは押しても何も起きず、「編集は設定者のみ」と表示される（押せてから断られる形にしない）", async () => {
    const notEditable = makeEvent({ id: "not-editable", title: "相手の予定", canEdit: false });
    listMock.mockResolvedValue({ items: [notEditable] });

    renderScreen();
    await screen.findByText("相手の予定");

    expect(screen.getByText(/編集は設定者のみ/)).toBeTruthy();

    fireEvent.click(screen.getByTestId(`event-row-${notEditable.id}-${notEditable.date}`));
    // フォームが開かない（タイトル入力欄が現れない）
    expect(screen.queryByTestId("event-form-title")).toBeNull();
  });

  it("canEdit:true のイベントは通常どおり押して編集でき、is_sharedの状態がチェックに反映される", async () => {
    const editable = makeEvent({ id: "editable", title: "ふたりの予定", canEdit: true, isShared: true });
    listMock.mockResolvedValue({ items: [editable] });

    renderScreen();
    fireEvent.click(await screen.findByTestId(`event-row-${editable.id}-${editable.date}`));

    expect(await screen.findByTestId("event-form-title")).toBeTruthy();
    expect(screen.getByText("✓ ふたりの予定")).toBeTruthy();
  });

  // 021: 記念日・会った日〈どちらでも編集できる〉から非共有planへの変換で
  // 相手（または自分）を締め出せる経路があったため、サーバのWHERE句で
  // 区分をまたぐ変換自体を禁じた（docs/tasks/021-plan-ownership.md「権限の
  // 条件を『操作』ではなく『状態遷移』で書く」）。画面側は「ふたりの予定」を
  // 条件付きで固定する形をやめ、押しても拒まれる選択（元がplan以外のときの
  // 「予定」への変更）そのものを選択肢から外す
  describe("元がplan以外のとき、種別の選択肢からplanを外す", () => {
    it("記念日を編集しているとき、「予定」の選択肢が無い", async () => {
      const anniversary = makeEvent({ id: "ann", title: "記念日", kind: "anniversary", repeatYearly: true, canEdit: true });
      listMock.mockResolvedValue({ items: [anniversary] });

      renderScreen();
      fireEvent.click(await screen.findByTestId(`event-row-${anniversary.id}-${anniversary.date}`));
      await screen.findByTestId("event-form-title");

      expect(screen.queryByTestId("event-form-kind-plan")).toBeNull();
      expect(screen.getByTestId("event-form-kind-anniversary")).toBeTruthy();
      expect(screen.getByTestId("event-form-kind-meetup")).toBeTruthy();
    });

    it("会った日を編集しているとき、「予定」の選択肢が無い", async () => {
      const meetup = makeEvent({ id: "meetup-1", title: "会った日", kind: "meetup", canEdit: true });
      listMock.mockResolvedValue({ items: [meetup] });

      renderScreen();
      fireEvent.click(await screen.findByTestId(`event-row-${meetup.id}-${meetup.date}`));
      await screen.findByTestId("event-form-title");

      expect(screen.queryByTestId("event-form-kind-plan")).toBeNull();
    });

    it("既存のplanを編集しているときは、「予定」の選択肢がある", async () => {
      const plan = makeEvent({ id: "plan-1", title: "予定", kind: "plan", isShared: false, canEdit: true });
      listMock.mockResolvedValue({ items: [plan] });

      renderScreen();
      fireEvent.click(await screen.findByTestId(`event-row-${plan.id}-${plan.date}`));
      await screen.findByTestId("event-form-title");

      expect(screen.getByTestId("event-form-kind-plan")).toBeTruthy();
    });

    it("新規作成では、3つとも選択肢にある", async () => {
      listMock.mockResolvedValue({ items: [] });
      renderScreen();
      await screen.findByText("予定はまだありません");

      fireEvent.click(screen.getByTestId("calendar-add-event"));

      expect(screen.getByTestId("event-form-kind-plan")).toBeTruthy();
      expect(screen.getByTestId("event-form-kind-anniversary")).toBeTruthy();
      expect(screen.getByTestId("event-form-kind-meetup")).toBeTruthy();
    });

    it("既存のplanを編集しているときは、「ふたりの予定」を自由にチェック・解除できる", async () => {
      const plan = makeEvent({ id: "plan-2", title: "予定", kind: "plan", isShared: false, canEdit: true });
      listMock.mockResolvedValue({ items: [plan] });

      renderScreen();
      fireEvent.click(await screen.findByTestId(`event-row-${plan.id}-${plan.date}`));
      await screen.findByTestId("event-form-title");
      expect(screen.getByText("ふたりの予定にする")).toBeTruthy();

      fireEvent.click(screen.getByTestId("event-form-is-shared"));
      expect(screen.getByText("✓ ふたりの予定")).toBeTruthy();
      // Buttonの二重発火防止ガード（queueMicrotask）が解けるまで1tick待つ
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(screen.getByTestId("event-form-is-shared"));
      expect(screen.getByText("ふたりの予定にする")).toBeTruthy();
    });

    it("新規作成では、「ふたりの予定」を自由にチェック・解除できる", async () => {
      listMock.mockResolvedValue({ items: [] });
      renderScreen();
      await screen.findByText("予定はまだありません");

      fireEvent.click(screen.getByTestId("calendar-add-event"));
      fireEvent.click(screen.getByTestId("event-form-is-shared"));
      expect(screen.getByText("✓ ふたりの予定")).toBeTruthy();
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(screen.getByTestId("event-form-is-shared"));
      expect(screen.getByText("ふたりの予定にする")).toBeTruthy();
    });
  });
});

// 014: デモ閲覧中は登録できない（サーバ側でFORBIDDENになる）ため、
// 「＋追加」を押してもフォームを開かせずログイン導線に差し替える
describe("014: デモ閲覧中の「＋追加」はログイン導線になる", () => {
  it("ボタンの文言が「ログインして追加」になり、押してもフォームが開かずexitGuestModeが呼ばれる", async () => {
    listMock.mockResolvedValue({ items: [] });
    const exitGuestMode = vi.fn();
    renderScreenAsGuest(exitGuestMode);
    await screen.findByText("予定はまだありません");

    const button = screen.getByTestId("calendar-add-event");
    expect(button.textContent).toContain("ログインして追加");

    fireEvent.click(button);

    expect(exitGuestMode).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("event-form-title")).toBeNull();
  });
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 019: プロフィール画面（記念日設定・名前とアイコン変更）の画面結合テスト。
// calendar-screen.test.tsxと同じ形でoRPCクライアントをモックする
const {
  meGetMock,
  meUpdateMock,
  meUploadImageUrlMock,
  coupleGetMock,
  coupleUpdateMock,
  statsGetMock,
  signOutMock,
} = vi.hoisted(() => ({
  meGetMock: vi.fn(),
  meUpdateMock: vi.fn(),
  meUploadImageUrlMock: vi.fn(),
  coupleGetMock: vi.fn(),
  coupleUpdateMock: vi.fn(),
  statsGetMock: vi.fn(),
  signOutMock: vi.fn(),
}));

// home-timeline.test.tsxと同じ理由（expo-image-picker/expo-image-manipulatorは
// "expo"パッケージの副作用のあるセットアップ経由でロードされ、jsdom環境で
// __DEV__未定義のままクラッシュする）。画像選択自体は操作しないため最小スタブに差し替える
vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));

vi.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: vi.fn() },
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

vi.mock("../lib/auth-client", () => ({
  signOut: signOutMock,
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    me: {
      get: meGetMock,
      update: meUpdateMock,
      uploadImageUrl: meUploadImageUrlMock,
    },
    couple: {
      get: coupleGetMock,
      update: coupleUpdateMock,
    },
    stats: {
      get: statsGetMock,
    },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: ProfileScreen } = await import("../app/(tabs)/profile");
const { queryClient } = await import("../lib/query");

function makeMe(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "me", name: "自分", email: "me@example.com", image: null, ...overrides };
}

function makeCouple(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "couple-1",
    anniversaryDate: "2020-01-01",
    marriedDate: null,
    primaryDate: "dating",
    createdAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  meGetMock.mockResolvedValue(makeMe());
  coupleGetMock.mockResolvedValue(makeCouple());
});

function renderScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfileScreen />
    </QueryClientProvider>,
  );
}

// me.get/couple.getの読み込み完了（フォームへの初期反映）を待つ。
// 入力欄自体はデータ到着前から存在するため、findByTestIdだけでは
// 読み込み完了を保証できない（初期化useEffectがクリック後に走ると
// 入力内容が上書きされてしまう）
async function waitForLoaded() {
  const dateInput = (await screen.findByTestId("profile-anniversary-date")) as HTMLInputElement;
  await waitFor(() => expect(dateInput.value).toBe("2020-01-01"));
  return dateInput;
}

describe("ProfileScreen: 初期表示", () => {
  it("名前・付き合った日・ホーム上部の表示が読み込んだデータで埋まる", async () => {
    renderScreen();
    await waitForLoaded();

    const nameInput = screen.getByTestId("profile-name") as HTMLInputElement;
    expect(nameInput.value).toBe("自分");
  });

  it("結婚した日が設定済みなら埋まる", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ marriedDate: "2023-05-01", primaryDate: "married" }));

    renderScreen();

    const marriedInput = (await screen.findByTestId("profile-married-date")) as HTMLInputElement;
    await waitFor(() => expect(marriedInput.value).toBe("2023-05-01"));
  });
});

describe("ProfileScreen: 保存", () => {
  it("名前を変更して保存すると me.update が呼ばれる", async () => {
    meUpdateMock.mockResolvedValue(makeMe({ name: "新しい名前" }));
    coupleUpdateMock.mockResolvedValue(makeCouple());

    renderScreen();
    await waitForLoaded();
    const nameInput = screen.getByTestId("profile-name");

    fireEvent.change(nameInput, { target: { value: "新しい名前" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-save"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(meUpdateMock).toHaveBeenCalledWith({ name: "新しい名前", imageId: undefined }, expect.anything()),
    );
  });

  it("記念日を変更して保存すると couple.update が呼ばれる", async () => {
    meUpdateMock.mockResolvedValue(makeMe());
    coupleUpdateMock.mockResolvedValue(makeCouple({ anniversaryDate: "2019-06-15" }));

    renderScreen();
    const dateInput = await waitForLoaded();

    fireEvent.change(dateInput, { target: { value: "2019-06-15" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-save"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(coupleUpdateMock).toHaveBeenCalledWith(
        { anniversaryDate: "2019-06-15", marriedDate: null, primaryDate: "dating" },
        expect.anything(),
      ),
    );
  });

  it("保存できると完了メッセージが出る", async () => {
    meUpdateMock.mockResolvedValue(makeMe());
    coupleUpdateMock.mockResolvedValue(makeCouple());

    renderScreen();
    await waitForLoaded();

    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-save"));
      await Promise.resolve();
    });

    expect(await screen.findByText(/保存しました/)).toBeTruthy();
  });

  it("保存に失敗するとエラーメッセージが出る", async () => {
    meUpdateMock.mockRejectedValue(new Error("network"));

    renderScreen();
    await waitForLoaded();

    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-save"));
      await Promise.resolve();
    });

    expect(await screen.findByText("保存できませんでした。もう一度お試しください")).toBeTruthy();
  });
});

describe("ProfileScreen: ホーム上部の表示（primaryDate）", () => {
  it("「結婚した日」を選び、結婚した日が空のままだと注記が出て保存できない", async () => {
    renderScreen();
    await waitForLoaded();

    fireEvent.click(screen.getByTestId("profile-primary-date-married"));

    expect(await screen.findByText(/結婚した日」を表示するには/)).toBeTruthy();

    // Buttonのdisabled表現はreact-native-webのPressableに依存し、
    // toBeDisabled()で確実に検出できるとは限らない（calendar-screen.test.tsxの
    // meetup衝突時と同じ理由で、実際に送信されないことで確認する）
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-save"));
      await Promise.resolve();
    });
    expect(meUpdateMock).not.toHaveBeenCalled();
    expect(coupleUpdateMock).not.toHaveBeenCalled();
  });

  it("「結婚した日」を選び、結婚した日も入力すれば保存できる", async () => {
    meUpdateMock.mockResolvedValue(makeMe());
    coupleUpdateMock.mockResolvedValue(makeCouple({ primaryDate: "married", marriedDate: "2023-05-01" }));

    renderScreen();
    await waitForLoaded();

    fireEvent.click(screen.getByTestId("profile-primary-date-married"));
    fireEvent.change(screen.getByTestId("profile-married-date"), { target: { value: "2023-05-01" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-save"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(coupleUpdateMock).toHaveBeenCalledWith(
        { anniversaryDate: "2020-01-01", marriedDate: "2023-05-01", primaryDate: "married" },
        expect.anything(),
      ),
    );
  });

  it("「非表示」を選んで保存できる", async () => {
    meUpdateMock.mockResolvedValue(makeMe());
    coupleUpdateMock.mockResolvedValue(makeCouple({ primaryDate: "none" }));

    renderScreen();
    await waitForLoaded();

    fireEvent.click(screen.getByTestId("profile-primary-date-none"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-save"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(coupleUpdateMock).toHaveBeenCalledWith(
        { anniversaryDate: "2020-01-01", marriedDate: null, primaryDate: "none" },
        expect.anything(),
      ),
    );
  });
});

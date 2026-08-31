import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
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
  inviteIssueMock,
  signOutMock,
  pushMock,
} = vi.hoisted(() => ({
  meGetMock: vi.fn(),
  meUpdateMock: vi.fn(),
  meUploadImageUrlMock: vi.fn(),
  coupleGetMock: vi.fn(),
  coupleUpdateMock: vi.fn(),
  statsGetMock: vi.fn(),
  inviteIssueMock: vi.fn(),
  signOutMock: vi.fn(),
  pushMock: vi.fn(),
}));

// 024: 「アカウントを削除」導線がuseRouterを使うようになったため、
// home-screen.test.tsxと同じ形でモックする
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock }),
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
  // useViewerQueryKey（apps/app/lib/viewer-key.ts）がauth-client経由で参照する。
  // このテストでは識別の中身自体は検証しないため固定値を返す
  useSession: () => ({ data: null }),
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
    invite: {
      issue: inviteIssueMock,
    },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: ProfileScreen } = await import("../app/(tabs)/profile");
const { queryClient } = await import("../lib/query");
const { GuestModeContext } = await import("../lib/guest-mode");

function makeMe(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "me", name: "自分", email: "me@example.com", image: null, ...overrides };
}

function makeCouple(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "couple-1",
    datingDate: "2020-01-01",
    marriedDate: null,
    primaryDate: "dating",
    createdAt: 0,
    ...overrides,
  };
}

// 025: 招待コードの再発行はstats.get().membersでペアが1人か2人かを見る。
// 既定は1人（相手が未参加）にしておき、025固有のテストでのみ2人に上書きする
function makeStats(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    daysTogether: { status: "dating", days: 1 },
    meetupDays: 0,
    postCount: 0,
    photoCount: 0,
    members: [{ userId: "me", name: "自分", image: null }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  meGetMock.mockResolvedValue(makeMe());
  coupleGetMock.mockResolvedValue(makeCouple());
  statsGetMock.mockResolvedValue(makeStats());
});

function renderScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfileScreen />
    </QueryClientProvider>,
  );
}

function renderScreenAsGuest(exitGuestMode: () => void) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GuestModeContext.Provider value={{ isGuestMode: true, enterGuestMode: () => {}, exitGuestMode, demoUnavailable: false }}>
        <ProfileScreen />
      </GuestModeContext.Provider>
    </QueryClientProvider>,
  );
}

// me.get/couple.getの読み込み完了（フォームへの初期反映）を待つ。
// 入力欄自体はデータ到着前から存在するため、findByTestIdだけでは
// 読み込み完了を保証できない（初期化useEffectがクリック後に走ると
// 入力内容が上書きされてしまう）
async function waitForLoaded() {
  const dateInput = (await screen.findByTestId("profile-dating-date")) as HTMLInputElement;
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

  // 016: 以前はme.get/couple.getのisLoading/isErrorを一切見ておらず、
  // 取得中・失敗時ともフォームが空欄のまま何も知らせず止まって見えた
  // （security-auditor全体監査・3状態レビュー指摘）
  it("読み込み中はローディング表示を出し、フォームは出さない", async () => {
    let resolveMe: (value: ReturnType<typeof makeMe>) => void = () => {};
    meGetMock.mockReturnValue(new Promise((resolve) => (resolveMe = resolve)));

    renderScreen();

    expect(await screen.findByText("読み込み中…")).toBeTruthy();
    expect(screen.queryByTestId("profile-name")).toBeNull();

    resolveMe(makeMe());
    await waitForLoaded();
    expect(screen.queryByText("読み込み中…")).toBeNull();
  });

  it(
    "取得に失敗するとエラー表示と再試行ボタンを出し、再試行すると再取得する",
    async () => {
      meGetMock.mockRejectedValue(new Error("network"));

      renderScreen();

      // 既定のリトライ（3回・指数バックオフ）が尽きるまでisErrorにならないため
      // 通常より長いタイムアウトを与える（calendar-screen.test.tsxと同じ理由）
      expect(await screen.findByText("マイページを読み込めませんでした", {}, { timeout: 10000 })).toBeTruthy();
      expect(screen.queryByTestId("profile-name")).toBeNull();

      meGetMock.mockResolvedValue(makeMe());
      fireEvent.click(screen.getByText("再試行"));

      await waitForLoaded();
    },
    15000,
  );
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
    coupleUpdateMock.mockResolvedValue(makeCouple({ datingDate: "2019-06-15" }));

    renderScreen();
    const dateInput = await waitForLoaded();

    fireEvent.change(dateInput, { target: { value: "2019-06-15" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-save"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(coupleUpdateMock).toHaveBeenCalledWith(
        { datingDate: "2019-06-15", marriedDate: null, primaryDate: "dating" },
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
        { datingDate: "2020-01-01", marriedDate: "2023-05-01", primaryDate: "married" },
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
        { datingDate: "2020-01-01", marriedDate: null, primaryDate: "none" },
        expect.anything(),
      ),
    );
  });
});

// 023: 登録時に付き合った日を聞かなくなったため、datingDateがnullのまま届く
// ケースが生じる。「マイページであとから設定する」が目的なので、そのマイページが
// 日付前提で動かなくなってはいけない（タスク定義の要望本体）
describe("ProfileScreen: datingDateが未設定（023）", () => {
  it("datingDateがnullのまま、名前だけ変更して保存できる", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ datingDate: null }));
    meUpdateMock.mockResolvedValue(makeMe({ name: "新しい名前" }));
    coupleUpdateMock.mockResolvedValue(makeCouple({ datingDate: null }));

    renderScreen();
    const nameInput = (await screen.findByTestId("profile-name")) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe("自分"));

    fireEvent.change(nameInput, { target: { value: "新しい名前" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-save"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(meUpdateMock).toHaveBeenCalledWith({ name: "新しい名前", imageId: undefined }, expect.anything()),
    );
    await waitFor(() =>
      expect(coupleUpdateMock).toHaveBeenCalledWith(
        { datingDate: null, marriedDate: null, primaryDate: "dating" },
        expect.anything(),
      ),
    );
  });

  it("datingDateがnullのまま、marriedDateだけ設定して保存できる", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ datingDate: null }));
    meUpdateMock.mockResolvedValue(makeMe());
    coupleUpdateMock.mockResolvedValue(
      makeCouple({ datingDate: null, marriedDate: "2023-05-01", primaryDate: "married" }),
    );

    renderScreen();
    const nameInput = (await screen.findByTestId("profile-name")) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe("自分"));

    fireEvent.click(screen.getByTestId("profile-primary-date-married"));
    fireEvent.change(screen.getByTestId("profile-married-date"), { target: { value: "2023-05-01" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-save"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(coupleUpdateMock).toHaveBeenCalledWith(
        { datingDate: null, marriedDate: "2023-05-01", primaryDate: "married" },
        expect.anything(),
      ),
    );
  });
});

// 025: 招待コードの再発行
describe("025: 招待コードの再発行", () => {
  it("ペアが1人のとき、押す前の注意書きと発行ボタンが出る。相手が参加済みの文言は出ない", async () => {
    statsGetMock.mockResolvedValue(makeStats({ members: [{ userId: "me", name: "自分", image: null }] }));
    renderScreen();

    expect(await screen.findByTestId("profile-reissue-invite")).toBeTruthy();
    // 押す前に伝える（025タスク定義。押したあとに気づく形にしない）
    expect(screen.getByText(/発行すると、以前発行した招待コードは無効になります/)).toBeTruthy();
    expect(screen.queryByText("相手が参加済みです")).toBeNull();
  });

  it("ペアが2人揃っているとき、発行ボタンは出ず「相手が参加済みです」が出る", async () => {
    statsGetMock.mockResolvedValue(
      makeStats({
        members: [
          { userId: "me", name: "自分", image: null },
          { userId: "partner", name: "相手", image: null },
        ],
      }),
    );
    renderScreen();

    expect(await screen.findByText("相手が参加済みです")).toBeTruthy();
    expect(screen.queryByTestId("profile-reissue-invite")).toBeNull();
  });

  it("発行ボタンを押すとinvite.issueが呼ばれ、コードと有効期限が表示される", async () => {
    inviteIssueMock.mockResolvedValue({ code: "ABCDEF", expiresAt: Math.floor(Date.now() / 1000) + 3600 });
    renderScreen();

    await act(async () => {
      fireEvent.click(await screen.findByTestId("profile-reissue-invite"));
      await Promise.resolve();
    });

    await waitFor(() => expect(inviteIssueMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("ABCDEF")).toBeTruthy();
    expect(screen.getByText("コードを再発行する")).toBeTruthy();
  });

  it("発行に失敗するとエラーメッセージが出る", async () => {
    inviteIssueMock.mockRejectedValue(new Error("failed"));
    renderScreen();

    await act(async () => {
      fireEvent.click(await screen.findByTestId("profile-reissue-invite"));
      await Promise.resolve();
    });

    expect(await screen.findByText("発行できませんでした。もう一度お試しください")).toBeTruthy();
  });

  // 【Rレビュー指摘R-1】この画面に到達している時点で認証済みのため、
  // ここで返るFORBIDDENは「満員」以外にありえない。「もう一度お試し
  // ください」は構造的に成功しない操作を勧めることになるため、
  // この文脈だけで理由を確定して案内し、statsQueryを再取得してカード
  // 自体も正しい表示（相手が参加済みです）に戻す
  it("発行時にFORBIDDEN（満員）が返ると、専用の文言が出てstatsが再取得される", async () => {
    inviteIssueMock.mockRejectedValue(new ORPCError("FORBIDDEN", { defined: true }));
    renderScreen();

    await act(async () => {
      fireEvent.click(await screen.findByTestId("profile-reissue-invite"));
      await Promise.resolve();
    });

    expect(await screen.findByText("相手が参加済みです")).toBeTruthy();
    expect(screen.queryByText("発行できませんでした。もう一度お試しください")).toBeNull();
    // 初回描画時の1回 + エラー後の再取得で2回以上呼ばれる
    await waitFor(() => expect(statsGetMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

// 024: 「アカウントを削除」の入口
describe("024: アカウントを削除の導線", () => {
  it("「アカウントを削除」を押すとdelete-accountへ遷移する", async () => {
    renderScreen();

    fireEvent.click(await screen.findByText("アカウントを削除"));

    expect(pushMock).toHaveBeenCalledWith("/delete-account");
  });
});

// 014: デモ閲覧中は「自分」が存在しない（me.getがnullを返す）ため、
// 編集フォームを出さずログインを促す
describe("014: デモ閲覧中はプロフィール編集フォームの代わりにログイン導線が出る", () => {
  it("名前入力欄が無く、ログインボタンを押すとexitGuestModeが呼ばれる", async () => {
    meGetMock.mockResolvedValue(null);
    const exitGuestMode = vi.fn();
    renderScreenAsGuest(exitGuestMode);

    expect(await screen.findByText("マイページはログインすると使えます")).toBeTruthy();
    expect(screen.queryByTestId("profile-name")).toBeNull();
    expect(screen.queryByTestId("profile-save")).toBeNull();

    fireEvent.click(screen.getByText("ログイン"));
    expect(exitGuestMode).toHaveBeenCalledTimes(1);
  });
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { APPEARANCE_STORAGE_KEY, AppearanceProvider, useAppearance } from "@futary/ui";
import { Text as RNText } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";

// プロフィール画面の画面結合テスト（019）。oRPC クライアントは calendar-screen.test.tsx と同じ形でモックする
const {
  meGetMock,
  meUpdateMock,
  meUploadImageUrlMock,
  meSetAiOptInMock,
  coupleGetMock,
  coupleUpdateMock,
  statsGetMock,
  inviteIssueMock,
  albumListMock,
  photoListMock,
  signOutMock,
  pushMock,
  updateWeatherAreaMock,
  billingPortalMock,
} = vi.hoisted(() => ({
  meGetMock: vi.fn(),
  meUpdateMock: vi.fn(),
  meUploadImageUrlMock: vi.fn(),
  meSetAiOptInMock: vi.fn(),
  coupleGetMock: vi.fn(),
  coupleUpdateMock: vi.fn(),
  statsGetMock: vi.fn(),
  inviteIssueMock: vi.fn(),
  // 「アルバムの写真をまとめて保存」がアルバムを辿って数える（048）
  albumListMock: vi.fn(),
  photoListMock: vi.fn(),
  signOutMock: vi.fn(),
  pushMock: vi.fn(),
  updateWeatherAreaMock: vi.fn(),
  // 「プランを管理 ›」（048）
  billingPortalMock: vi.fn(),
}));

// 「アカウントを削除」の導線が useRouter を使う
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// expo-image-picker・expo-image-manipulator は "expo" の副作用のあるセットアップ経由で読まれ、jsdom
// では __DEV__ 未定義で落ちる。画像選択は操作しないので最小のスタブにする
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
  // useViewerQueryKey が auth-client 経由で参照する。識別の中身は見ないので固定値
  useSession: () => ({ data: null }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    me: {
      get: meGetMock,
      update: meUpdateMock,
      uploadImageUrl: meUploadImageUrlMock,
      setAiOptIn: meSetAiOptInMock,
      // 天気の地域（058）
      updateWeatherArea: updateWeatherAreaMock,
    },
    weather: { get: vi.fn(), getForDate: vi.fn() },
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
    album: { list: albumListMock },
    photo: { list: photoListMock, downloadUrl: vi.fn() },
    billing: { createPortalSession: billingPortalMock },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: ProfileScreen } = await import("../app/(tabs)/profile");
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

function makeCouple(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "couple-1",
    datingDate: "2020-01-01",
    marriedDate: null,
    primaryDate: "dating",
    createdAt: 0,
    // couple.get は plan と albumQuota も返す。既定は free（行なし。045）
    plan: "free",
    albumQuota: { limit: 30, used: 0 },
    // 048
    planSource: null,
    planExpiresAt: null,
    planCancelAt: null,
    ...overrides,
  };
}

// 招待コードの再発行は stats.get().members でペアの人数を見る。既定は 1 人（相手が未参加）で、
// 再発行のテストでだけ 2 人に上書きする（025）
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
  meSetAiOptInMock.mockResolvedValue({ aiOptIn: true });
  coupleGetMock.mockResolvedValue(makeCouple());
  statsGetMock.mockResolvedValue(makeStats());
  billingPortalMock.mockResolvedValue({ url: "https://billing.stripe.com/p/session/x" });
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

// me.get・couple.get の読み込み完了（フォームへの初期反映）を待つ。入力欄はデータ到着前からあるので
// findByTestId だけでは足りない（初期化の useEffect がクリック後に走ると入力が上書きされる）
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

  // 取得中・失敗を知らせる（フォームが空欄のまま止まって見えないように。016）
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

      // 既定のリトライ（3 回・指数バックオフ）が尽きるまで isError にならないので長めに待つ
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

    // Button の disabled は react-native-web の Pressable 次第で toBeDisabled() では確実に拾えないので、
    // 実際に送信されないことで確かめる
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

// 登録時に付き合った日を聞かないので、datingDate が null のまま届く。マイページはあとから設定する
// 場所なので、日付が無くても動かなければならない（023）
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

// 招待コードの再発行（025）
describe("025: 招待コードの再発行", () => {
  it("ペアが1人のとき、押す前の注意書きと発行ボタンが出る。相手が参加済みの文言は出ない", async () => {
    statsGetMock.mockResolvedValue(makeStats({ members: [{ userId: "me", name: "自分", image: null }] }));
    renderScreen();

    expect(await screen.findByTestId("profile-reissue-invite")).toBeTruthy();
    // 押す前に伝える（押したあとに気づく形にしない）
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

  // この画面に居る時点で認証済みなので、FORBIDDEN は「満員」しかない。「もう一度お試しください」は
  // 成功しない操作を勧めることになるので、理由を確定して案内し、stats を再取得してカードも
  // 「相手が参加済みです」に戻す
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

// 「アカウントを削除」の入口（024）
describe("024: アカウントを削除の導線", () => {
  it("「アカウントを削除」を押すとdelete-accountへ遷移する", async () => {
    renderScreen();

    fireEvent.click(await screen.findByText("アカウントを削除"));

    expect(pushMock).toHaveBeenCalledWith("/delete-account");
  });
});

// デモ閲覧中は「自分」が居ない（me.get が null）ので、編集フォームを出さずログインを促す（014）
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

// マイページの「見た目」カード（039 T6）。押すと useAppearance().appearance が変わり、ゲストでも出る。
// Provider 配下の別の部品（プローブ）で観測する
function AppearanceProbe() {
  const { appearance } = useAppearance();
  return <RNText testID="appearance-probe">{appearance}</RNText>;
}

function renderWithAppearance(guest: boolean) {
  const inner = guest ? (
    <GuestModeContext.Provider
      value={{ isGuestMode: true, enterGuestMode: () => {}, exitGuestMode: () => {}, demoUnavailable: false }}
    >
      <ProfileScreen />
    </GuestModeContext.Provider>
  ) : (
    <ProfileScreen />
  );
  return render(
    <AppearanceProvider>
      <QueryClientProvider client={queryClient}>
        <AppearanceProbe />
        {inner}
      </QueryClientProvider>
    </AppearanceProvider>,
  );
}

describe("039: 見た目（ピンク/ホワイト）の切り替え（T6）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("ログイン済み: 「ホワイト」を押すと appearance が white になり、localStorage に保存される", async () => {
    renderWithAppearance(false);
    await waitForLoaded();
    expect(screen.getByTestId("appearance-probe").textContent).toBe("pink");
    expect(screen.getByText("この端末だけの設定です。相手には反映されません")).toBeTruthy();

    fireEvent.click(screen.getByTestId("profile-appearance-white"));
    expect(screen.getByTestId("appearance-probe").textContent).toBe("white");
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("white");

    fireEvent.click(screen.getByTestId("profile-appearance-pink"));
    expect(screen.getByTestId("appearance-probe").textContent).toBe("pink");
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("pink");
  });

  it("ゲストでもカードが出て、切り替えられる（ログイン不要の設定）", async () => {
    meGetMock.mockResolvedValue(null);
    renderWithAppearance(true);

    expect(await screen.findByText("マイページはログインすると使えます")).toBeTruthy();
    expect(screen.getByText("見た目")).toBeTruthy();
    expect(screen.queryByTestId("profile-name")).toBeNull();

    fireEvent.click(screen.getByTestId("profile-appearance-white"));
    expect(screen.getByTestId("appearance-probe").textContent).toBe("white");
  });

  it("見た目カードは記念日カードより上、プロフィールカードより下に出る", async () => {
    renderWithAppearance(false);
    await waitForLoaded();
    const profile = screen.getByText("プロフィール");
    const appearance = screen.getByText("見た目");
    const anniversary = screen.getByText("記念日");
    // DOM の前後関係で並び順を見る（compareDocumentPosition: 4 = 後続）
    expect(profile.compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(appearance.compareDocumentPosition(anniversary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// 「プラン: 無料／プレミアム」の 1 行（couple.get の plan から）。無料のときだけ「プレミアムについて ›」
// （→ /premium。045 T8）
describe("ProfileScreen: プラン（045）", () => {
  it("free なら「プラン: 無料」と「プレミアムについて ›」（→ /premium）", async () => {
    renderScreen();
    await waitForLoaded();
    // 「プラン: 」は入れ子の Text で描くため、外側の自前の文字だけで見る（末尾の空白は正規化で消える）
    expect(screen.getByText(/^プラン:/)).toBeTruthy();
    expect(screen.getByTestId("profile-plan")).toHaveTextContent("無料");
    fireEvent.click(screen.getByTestId("profile-premium"));
    expect(pushMock).toHaveBeenCalledWith("/premium");
  });

  it("paid（manual・無期限）なら「プラン: プレミアム」。「プレミアムについて」も「プランを管理」も無い", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ plan: "paid", albumQuota: null, planSource: "manual", planExpiresAt: null }));
    renderScreen();
    await waitForLoaded();
    expect(screen.getByTestId("profile-plan")).toHaveTextContent("プレミアム");
    expect(screen.getByTestId("profile-plan")).not.toHaveTextContent("更新");
    expect(screen.queryByTestId("profile-premium")).toBeNull();
    expect(screen.queryByTestId("profile-manage-plan")).toBeNull();
  });

  // stripe の paid は「プレミアム（9月15日に更新）」と「プランを管理 ›」（→ Billing Portal。048）
  it("paid（stripe）なら「プレミアム（〇月〇日に更新）」と「プランを管理 ›」。押すと Portal の URL へ", async () => {
    // 2026-09-15 00:00 JST = 2026-09-14 15:00 UTC
    const expiresAt = Date.UTC(2026, 8, 14, 15, 0, 0) / 1000;
    coupleGetMock.mockResolvedValue(makeCouple({ plan: "paid", albumQuota: null, planSource: "stripe", planExpiresAt: expiresAt }));
    const assigned: string[] = [];
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: (url: string) => assigned.push(url), origin: "http://localhost" },
    });
    try {
      renderScreen();
      await waitForLoaded();
      expect(screen.getByTestId("profile-plan")).toHaveTextContent("プレミアム（9月15日に更新）");
      expect(screen.queryByTestId("profile-premium")).toBeNull();
      fireEvent.click(screen.getByTestId("profile-manage-plan"));
      await waitFor(() => expect(billingPortalMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(assigned).toEqual(["https://billing.stripe.com/p/session/x"]));
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("期間の終わりで解約済み（planCancelAt）なら「プレミアム（〇月〇日まで）」。「プランを管理 ›」は残る（取り消せる）", async () => {
    const end = Date.UTC(2026, 9, 14, 15, 0, 0) / 1000; // 2026-10-15 JST
    coupleGetMock.mockResolvedValue(
      makeCouple({ plan: "paid", albumQuota: null, planSource: "stripe", planExpiresAt: end, planCancelAt: end }),
    );
    renderScreen();
    await waitForLoaded();
    expect(screen.getByTestId("profile-plan")).toHaveTextContent("プレミアム（10月15日まで）");
    expect(screen.getByTestId("profile-plan")).not.toHaveTextContent("更新");
    expect(screen.getByTestId("profile-manage-plan")).toBeTruthy();
  });

  it("ゲストには出ない（マイページ自体がログイン案内）", () => {
    renderScreenAsGuest(() => {});
    expect(screen.queryByTestId("profile-plan")).toBeNull();
    expect(screen.queryByTestId("profile-zip")).toBeNull();
  });
});

// プランの行の下の「アルバムの写真をまとめて保存 ›」→「すべての写真を ZIP で保存」のシート（048）
describe("ProfileScreen: アルバムの写真をまとめて保存（048）", () => {
  it("押すとシートが開き、作ったアルバムの枚数を出す（paid でも出る）", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ plan: "paid", albumQuota: null }));
    albumListMock.mockResolvedValue({ timeline: { photoCount: 9, previews: [] }, items: [{ id: "album-1", title: "京都旅行", photoCount: 1 }] });
    photoListMock.mockResolvedValue({ items: [{ ref: { kind: "album", photoId: "photo-1" }, caption: "" }], nextCursor: null });
    renderScreen();
    await waitForLoaded();

    fireEvent.click(screen.getByTestId("profile-zip"));

    expect(await screen.findByText("すべての写真を ZIP で保存")).toBeTruthy();
    expect(await screen.findByTestId("zip-export-confirm")).toHaveTextContent("1 枚を ZIP で保存します");
    expect(photoListMock.mock.calls.map((c) => c[0].albumId)).toEqual(["album-1"]);
  });
});

// 一番下にプライバシーポリシー・利用規約のリンク（ログイン後・ゲストの両方。052 T3）。押すとサイトの
// ルートの /privacy・/terms を Linking.openURL で開く（apps/app/components/legal-links.tsx）
describe("ProfileScreen: プライバシーポリシー・利用規約（052）", () => {
  it("ログイン後: リンクがあり、押すと /privacy・/terms を開く", async () => {
    const { getApiOrigin } = await import("../lib/api-origin");
    const { Linking } = await import("react-native");
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(true);

    renderScreen();
    await waitForLoaded();

    fireEvent.click(screen.getByTestId("legal-privacy"));
    expect(openUrl).toHaveBeenCalledWith(`${getApiOrigin()}/privacy`);
    fireEvent.click(screen.getByTestId("legal-terms"));
    expect(openUrl).toHaveBeenCalledWith(`${getApiOrigin()}/terms`);
    // 「アカウントを削除」等の遷移は巻き込まれない
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("ゲスト: ログイン案内の下にも同じリンクがある", async () => {
    const { getApiOrigin } = await import("../lib/api-origin");
    const { Linking } = await import("react-native");
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(true);

    renderScreenAsGuest(() => {});

    expect(await screen.findByText("マイページはログインすると使えます")).toBeTruthy();
    fireEvent.click(screen.getByTestId("legal-terms"));
    expect(openUrl).toHaveBeenCalledWith(`${getApiOrigin()}/terms`);
  });
});

// マイページの帯（プランの行の上）。「ZIP で保存」は「アルバムの写真をまとめて保存」と同じシート（047 T8）
describe("ProfileScreen: やめたあとの鍵の帯（047）", () => {
  const LOCK_AT = Date.UTC(2026, 9, 15, 15, 0, 0) / 1000;

  it("猶予中: 帯に日付と「ZIP で保存」。押すとすべての写真のシート", async () => {
    coupleGetMock.mockResolvedValue(
      makeCouple({ plan: "free", albumQuota: { limit: 30, used: 40 }, planState: { plan: "free", lockAt: LOCK_AT, locked: false } }),
    );
    albumListMock.mockResolvedValue({ timeline: { photoCount: 0, previews: [] }, items: [] });
    renderScreen();
    await waitForLoaded();

    expect(screen.getByTestId("lock-band-grace")).toHaveTextContent("2026年10月16日までに写真を保存してください");
    fireEvent.click(screen.getByTestId("lock-band-zip"));
    expect(await screen.findByText("すべての写真を ZIP で保存")).toBeTruthy();
  });

  it("鍵の後: 「無料枠を超える 10 枚は見られません」。paid には帯が無い", async () => {
    coupleGetMock.mockResolvedValue(
      makeCouple({ plan: "free", albumQuota: { limit: 30, used: 40 }, planState: { plan: "free", lockAt: LOCK_AT, locked: true } }),
    );
    renderScreen();
    await waitForLoaded();
    expect(screen.getByTestId("lock-band-locked")).toHaveTextContent("無料枠を超える 10 枚は見られません");
    expect(screen.queryByTestId("lock-band-zip")).toBeNull();
  });
});

// 「運営 ›」は isAdmin のときだけ。押すと /admin（057 T7）
describe("ProfileScreen: 運営の入口（057）", () => {
  it("運営でなければ無い", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ isAdmin: false }));
    renderScreen();
    await waitForLoaded();
    expect(screen.queryByTestId("profile-admin")).toBeNull();
  });

  it("運営なら「運営 ›」が出て、押すと /admin", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ isAdmin: true }));
    renderScreen();
    await waitForLoaded();
    fireEvent.click(await screen.findByTestId("profile-admin"));
    expect(pushMock).toHaveBeenCalledWith("/admin");
  });
});

// 「天気の地域」（都道府県 → 予報区の 2 段。「設定しない」で null。058 T7）
describe("ProfileScreen: 天気の地域（058）", () => {
  it("未設定なら「未設定 ›」。押すと都道府県の一覧。予報区が 1 つの県（大阪府）はその場で決まり me.updateWeatherArea が呼ばれる", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ weatherArea: null }));
    updateWeatherAreaMock.mockResolvedValue({});
    renderScreen();
    await waitForLoaded();
    expect(screen.getByTestId("profile-weather-area")).toHaveTextContent("未設定 ›");
    fireEvent.click(screen.getByTestId("profile-weather-area"));
    expect(await screen.findByTestId("weather-area-sheet")).toBeTruthy();
    expect(screen.getByTestId("weather-pref-北海道")).toHaveTextContent("北海道 ›");
    expect(screen.getByTestId("weather-pref-大阪府")).toHaveTextContent("大阪府");
    await act(async () => {
      fireEvent.click(screen.getByTestId("weather-pref-大阪府"));
    });
    await waitFor(() => expect(updateWeatherAreaMock).toHaveBeenCalledWith({ areaCode: "270000" }, expect.anything()));
  });

  it("予報区が複数の県（東京都）は 2 段目。伊豆諸島北部を選ぶ。設定済みなら名前が出て、「設定しない」で null", async () => {
    coupleGetMock.mockResolvedValue(makeCouple({ weatherArea: { code: "130010", name: "東京地方" } }));
    updateWeatherAreaMock.mockResolvedValue({});
    renderScreen();
    await waitForLoaded();
    expect(screen.getByTestId("profile-weather-area")).toHaveTextContent("東京地方 ›");
    fireEvent.click(screen.getByTestId("profile-weather-area"));
    await screen.findByTestId("weather-area-sheet");
    fireEvent.click(screen.getByTestId("weather-pref-東京都"));
    expect(await screen.findByTestId("weather-area-130020")).toHaveTextContent("伊豆諸島北部");
    expect(screen.getByTestId("weather-area-130010")).toHaveTextContent("東京地方");
    await act(async () => {
      fireEvent.click(screen.getByTestId("weather-area-130020"));
    });
    await waitFor(() => expect(updateWeatherAreaMock).toHaveBeenCalledWith({ areaCode: "130020" }, expect.anything()));

    // 開き直して「設定しない」
    fireEvent.click(screen.getByTestId("profile-weather-area"));
    await screen.findByTestId("weather-area-sheet");
    await act(async () => {
      fireEvent.click(screen.getByTestId("weather-area-none"));
    });
    await waitFor(() => expect(updateWeatherAreaMock).toHaveBeenCalledWith({ areaCode: null }, expect.anything()));
  });
});

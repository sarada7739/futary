import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Linking } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 040: ほしいもの画面の結合テスト（T10）。list-screen.test.tsx と同じ形で oRPC クライアントをモックする
const { listMock, createMock, updateMock, setImageMock, setObtainedMock, deleteMock, uploadUrlMock } = vi.hoisted(
  () => ({
    listMock: vi.fn(),
    createMock: vi.fn(),
    updateMock: vi.fn(),
    setImageMock: vi.fn(),
    setObtainedMock: vi.fn(),
    deleteMock: vi.fn(),
    uploadUrlMock: vi.fn(),
  }),
);

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "me", name: "自分", email: "me@example.com", image: null } },
    isPending: false,
  }),
}));

// lib/image は expo-image-manipulator（ネイティブモジュール）を読むため、画面テストでは差し替える
vi.mock("../lib/image", () => ({
  compressImage: vi.fn(),
  uploadCompressedImage: vi.fn(),
}));

vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: false })),
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true, assets: [] })),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    want: {
      list: listMock,
      create: createMock,
      update: updateMock,
      setImage: setImageMock,
      setObtained: setObtainedMock,
      delete: deleteMock,
      uploadUrl: uploadUrlMock,
    },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: WantScreen } = await import("../app/(tabs)/want");
const { queryClient } = await import("../lib/query");
const { GuestModeContext } = await import("../lib/guest-mode");

type WantLike = Record<string, unknown>;

function makeWant(overrides: WantLike = {}): WantLike {
  return {
    id: "want-1",
    title: "ペアのマグカップ",
    url: "https://shop.example.com/items/pair-mug",
    note: "",
    image: null,
    isMine: false,
    ownerName: "相手",
    obtainedAt: null,
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

// ownerSide ごとの応答を返す
function stubLists(sides: { partner: { items: WantLike[]; ownerName: string | null }; me: { items: WantLike[]; ownerName: string | null } }) {
  listMock.mockImplementation(async (input: { ownerSide: "me" | "partner" }) => sides[input.ownerSide]);
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

function renderScreen(options: { guest?: boolean } = {}) {
  const tree = (
    <QueryClientProvider client={queryClient}>
      <WantScreen />
    </QueryClientProvider>
  );
  if (!options.guest) return render(tree);
  return render(
    <GuestModeContext.Provider
      value={{ isGuestMode: true, enterGuestMode: () => {}, exitGuestMode: () => {}, demoUnavailable: false }}
    >
      {tree}
    </GuestModeContext.Provider>,
  );
}

const partnerItem = makeWant({ id: "p-1", title: "相手のほしいもの", isMine: false, ownerName: "相手" });
const myItem = makeWant({ id: "m-1", title: "自分のほしいもの", isMine: true, ownerName: "自分" });

describe("WantScreen: 人物のタブ（T10）", () => {
  it("初期タブは相手。相手の行が出て、自分の行は出ない。+ ボタンも無い", async () => {
    stubLists({ partner: { items: [partnerItem], ownerName: "相手" }, me: { items: [myItem], ownerName: "自分" } });

    renderScreen();

    expect(await screen.findByText("相手のほしいもの")).toBeTruthy();
    expect(screen.queryByText("自分のほしいもの")).toBeNull();
    expect(screen.queryByLabelText("ほしいものを追加")).toBeNull();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveTextContent("相手");
    expect(tabs[1]).toHaveTextContent("自分");
  });

  it("自分のタブを選ぶと + ボタンが出て、自分の行が出る", async () => {
    stubLists({ partner: { items: [partnerItem], ownerName: "相手" }, me: { items: [myItem], ownerName: "自分" } });

    renderScreen();
    await screen.findByText("相手のほしいもの");
    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);

    expect(await screen.findByText("自分のほしいもの")).toBeTruthy();
    expect(screen.getByLabelText("ほしいものを追加")).toBeTruthy();
    expect(screen.queryByText("相手のほしいもの")).toBeNull();
  });

  it("1 人のペア（partner の ownerName が null）はタブを出さず、自分の一覧と + ボタンを出す", async () => {
    stubLists({ partner: { items: [], ownerName: null }, me: { items: [], ownerName: "自分" } });

    renderScreen();

    expect(await screen.findByLabelText("ほしいものを追加")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText("URL を貼ると画像が付きます")).toBeTruthy();
  });

  it("空の相手のタブは「まだありません」", async () => {
    stubLists({ partner: { items: [], ownerName: "相手" }, me: { items: [], ownerName: "自分" } });

    renderScreen();

    expect(await screen.findByText("まだありません")).toBeTruthy();
  });

  it("ゲストは + ボタンが無い（自分のタブでもログイン導線だけ）", async () => {
    stubLists({ partner: { items: [partnerItem], ownerName: "ゆい" }, me: { items: [], ownerName: "れん" } });

    renderScreen({ guest: true });

    expect(await screen.findByText("相手のほしいもの")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);
    expect(await screen.findByText("追加はログインすると使えます")).toBeTruthy();
    expect(screen.queryByLabelText("ほしいものを追加")).toBeNull();
  });
});

describe("WantScreen: 行", () => {
  it("相手の行にはメニュー（…）が無く、自分の行にはある", async () => {
    stubLists({ partner: { items: [partnerItem], ownerName: "相手" }, me: { items: [myItem], ownerName: "自分" } });

    renderScreen();
    await screen.findByText("相手のほしいもの");
    expect(screen.queryByLabelText("相手のほしいもの のメニュー")).toBeNull();

    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);
    expect(await screen.findByLabelText("自分のほしいもの のメニュー")).toBeTruthy();
  });

  it("URL のある行を押すと Linking.openURL で開く。URL の無い行は何もしない", async () => {
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(true);
    const noUrl = makeWant({ id: "p-2", title: "URL の無いもの", url: null });
    stubLists({ partner: { items: [partnerItem, noUrl], ownerName: "相手" }, me: { items: [], ownerName: "自分" } });

    renderScreen();
    fireEvent.click(await screen.findByTestId("want-card-p-1"));
    expect(openUrl).toHaveBeenCalledWith("https://shop.example.com/items/pair-mug");

    openUrl.mockClear();
    fireEvent.click(screen.getByTestId("want-card-p-2"));
    expect(openUrl).not.toHaveBeenCalled();
    openUrl.mockRestore();
  });

  it("手に入れたものには「手に入れた」のバッジが出る", async () => {
    const obtained = makeWant({ id: "p-3", title: "もう持っている", obtainedAt: 1 });
    stubLists({ partner: { items: [partnerItem, obtained], ownerName: "相手" }, me: { items: [], ownerName: "自分" } });

    renderScreen();

    expect(await screen.findByText("手に入れた")).toBeTruthy();
  });

  it("メニューから「手に入れた」を押すと want.setObtained が obtained: true で呼ばれる", async () => {
    stubLists({ partner: { items: [], ownerName: "相手" }, me: { items: [myItem], ownerName: "自分" } });
    setObtainedMock.mockResolvedValue({ ...myItem, obtainedAt: 1 });

    renderScreen();
    await screen.findByText("まだありません");
    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);
    fireEvent.click(await screen.findByLabelText("自分のほしいもの のメニュー"));
    await act(async () => {
      fireEvent.click(await screen.findByText("手に入れた"));
      await Promise.resolve();
    });

    await waitFor(() => expect(setObtainedMock).toHaveBeenCalledWith({ id: "m-1", obtained: true }, expect.anything()));
  });
});

describe("WantScreen: 追加", () => {
  it("URL だけ入れて保存すると want.create が url で呼ばれる。画像が取れなければ1行出る", async () => {
    stubLists({ partner: { items: [], ownerName: "相手" }, me: { items: [], ownerName: "自分" } });
    createMock.mockResolvedValue(makeWant({ id: "new", title: "shop.example.com", isMine: true, image: null }));

    renderScreen();
    await screen.findByText("まだありません");
    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);
    fireEvent.click(await screen.findByLabelText("ほしいものを追加"));

    const urlInput = await screen.findByTestId("want-form-url");
    fireEvent.change(urlInput, { target: { value: "https://shop.example.com/items/1" } });
    await act(async () => {
      fireEvent.click(screen.getByText("保存"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        { title: undefined, url: "https://shop.example.com/items/1", note: undefined, imageId: undefined },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("画像は取れませんでした。あとから付けられます")).toBeTruthy();
  });

  it("題名も URL も無いと保存できない。http 以外の URL も保存できない", async () => {
    stubLists({ partner: { items: [], ownerName: "相手" }, me: { items: [], ownerName: "自分" } });

    renderScreen();
    await screen.findByText("まだありません");
    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);
    fireEvent.click(await screen.findByLabelText("ほしいものを追加"));

    fireEvent.click(await screen.findByText("保存"));
    expect(createMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("want-form-url"), { target: { value: "javascript:alert(1)" } });
    expect(await screen.findByText("http または https の URL を入力してください")).toBeTruthy();
    fireEvent.click(screen.getByText("保存"));
    expect(createMock).not.toHaveBeenCalled();
  });
});

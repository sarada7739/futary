import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 041: アルバム一覧の画面結合テスト（T11 の一覧側）。want-screen.test.tsx と同じ形で oRPC を
// モックする。ヘッダーの + は expo-router の navigation.setOptions で置くため、setOptions に
// 渡された headerRight を描画して確かめる
const { listMock, createMock, updateMock, deleteMock, uploadUrlMock, pushMock, setOptionsMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  uploadUrlMock: vi.fn(),
  pushMock: vi.fn(),
  setOptionsMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
  useNavigation: () => ({ setOptions: setOptionsMock }),
}));

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
    album: { list: listMock, create: createMock, update: updateMock, delete: deleteMock, uploadUrl: uploadUrlMock },
    photo: { downloadUrl: vi.fn() },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: AlbumScreen } = await import("../app/(tabs)/album");
const { queryClient } = await import("../lib/query");
const { GuestModeContext } = await import("../lib/guest-mode");

type AlbumLike = Record<string, unknown>;

function makeAlbum(overrides: AlbumLike = {}): AlbumLike {
  return {
    id: "album-1",
    title: "京都旅行",
    note: "",
    startDate: "2026-08-15",
    endDate: "2026-08-17",
    photoCount: 38,
    cover: { url: "https://example.com/cover.jpg", width: 100, height: 100 },
    createdAt: 1_789_000_000,
    ...overrides,
  };
}

function makePhoto(i: number) {
  return {
    ref: { kind: "post", postId: `post-${i}`, position: 0 },
    url: `https://example.com/p${i}.jpg`,
    width: 100,
    height: 100,
    takenAt: 1_789_000_000 - i,
    caption: `投稿 ${i}`,
  };
}

function stubList(items: AlbumLike[], timeline = { photoCount: 0, previews: [] as unknown[] }) {
  listMock.mockResolvedValue({ timeline, items });
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

function renderScreen(options: { guest?: boolean } = {}) {
  const tree = (
    <QueryClientProvider client={queryClient}>
      <AlbumScreen />
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

// setOptions に最後に渡された headerRight を描画する（無ければ null）
function renderHeaderRight(): ReturnType<typeof render> | null {
  const last = setOptionsMock.mock.calls.at(-1)?.[0] as { headerRight?: () => ReactElement } | undefined;
  if (!last?.headerRight) return null;
  return render(last.headerRight());
}

describe("AlbumScreen: 一覧（T11）", () => {
  it("タイムラインのカードとアルバムのカード（題名・枚数・期間の年月）が出る。メンバーには ⋯ とヘッダーの + がある", async () => {
    stubList([makeAlbum(), makeAlbum({ id: "album-2", title: "沖縄", startDate: null, endDate: null, photoCount: 0, cover: null, createdAt: 1_783_000_000 })], {
      photoCount: 125,
      previews: [makePhoto(1), makePhoto(2), makePhoto(3), makePhoto(4)],
    });

    renderScreen();

    expect(await screen.findByText("京都旅行")).toBeTruthy();
    expect(screen.getByText("125 枚")).toBeTruthy();
    expect(screen.getByText("38 枚")).toBeTruthy();
    expect(screen.getByText("2026/08")).toBeTruthy();
    // 期間が無ければ createdAt の年月（2026-07-02 JST）
    expect(screen.getByText("2026/07")).toBeTruthy();
    expect(screen.getByTestId("album-cover-album-1")).toBeTruthy();
    expect(screen.queryByTestId("album-cover-album-2")).toBeNull();
    expect(screen.getByLabelText("京都旅行 のメニュー")).toBeTruthy();

    const header = renderHeaderRight();
    expect(header).not.toBeNull();
    expect(screen.getByLabelText("アルバムを作る")).toBeTruthy();
  });

  it("タイムラインのカードを押すと /album-detail?id=timeline、アルバムを押すと /album-detail?id=<id>", async () => {
    stubList([makeAlbum()]);
    renderScreen();

    fireEvent.click(await screen.findByTestId("album-timeline-card"));
    expect(pushMock).toHaveBeenCalledWith("/album-detail?id=timeline");
    fireEvent.click(screen.getByTestId("album-card-album-1"));
    expect(pushMock).toHaveBeenCalledWith("/album-detail?id=album-1");
  });

  it("写真が 0 枚でもタイムラインのカードは出て「まだ写真がありません」。アルバムが無ければ案内の一文", async () => {
    stubList([]);
    renderScreen();

    expect(await screen.findByTestId("album-timeline-card")).toBeTruthy();
    expect(screen.getByText("まだ写真がありません")).toBeTruthy();
    expect(screen.getByText("イベントごとに写真をまとめられます")).toBeTruthy();
  });

  it("ゲストは ⋯ もヘッダーの + も無い", async () => {
    stubList([makeAlbum()]);
    renderScreen({ guest: true });

    expect(await screen.findByText("京都旅行")).toBeTruthy();
    expect(screen.queryByLabelText("京都旅行 のメニュー")).toBeNull();
    expect(renderHeaderRight()).toBeNull();
    expect(screen.queryByLabelText("アルバムを作る")).toBeNull();
  });
});

describe("AlbumScreen: 作成・編集・削除", () => {
  it("+ → 題名を入れて作成すると album.create が呼ばれ、詳細へ進む", async () => {
    stubList([]);
    createMock.mockResolvedValue(makeAlbum({ id: "new-1", title: "新しい" }));
    renderScreen();
    await screen.findByTestId("album-timeline-card");
    renderHeaderRight();
    fireEvent.click(screen.getByLabelText("アルバムを作る"));

    fireEvent.change(await screen.findByTestId("album-form-title"), { target: { value: "新しい" } });
    await act(async () => {
      fireEvent.click(screen.getByText("作成"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        { title: "新しい", note: undefined, startDate: undefined, endDate: undefined, cover: undefined },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/album-detail?id=new-1"));
  });

  it("開始日より前の終了日では作成できず、理由が 1 行出る", async () => {
    stubList([]);
    renderScreen();
    await screen.findByTestId("album-timeline-card");
    renderHeaderRight();
    fireEvent.click(screen.getByLabelText("アルバムを作る"));

    fireEvent.change(await screen.findByTestId("album-form-title"), { target: { value: "x" } });
    fireEvent.change(screen.getByTestId("album-form-start"), { target: { value: "20260815" } });
    fireEvent.change(screen.getByTestId("album-form-end"), { target: { value: "20260810" } });
    expect(await screen.findByText("終了日は開始日以降の日付にしてください")).toBeTruthy();
    fireEvent.click(screen.getByText("作成"));
    expect(createMock).not.toHaveBeenCalled();
  });

  it("⋯ → 削除 → 確認の一文 → 削除する で album.delete が呼ばれる", async () => {
    stubList([makeAlbum()]);
    deleteMock.mockResolvedValue({ id: "album-1" });
    renderScreen();

    fireEvent.click(await screen.findByLabelText("京都旅行 のメニュー"));
    fireEvent.click(await screen.findByText("削除"));
    expect(await screen.findByText("アルバムを削除しますか？ 中の写真も消えます")).toBeTruthy();
    expect(deleteMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText("削除する"));
      await Promise.resolve();
    });

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith({ id: "album-1" }, expect.anything()));
  });

  it("⋯ → 編集 で既存の値が入ったフォームが出て、保存で album.update が呼ばれる", async () => {
    stubList([makeAlbum({ note: "紅葉" })]);
    updateMock.mockResolvedValue(makeAlbum({ title: "京都" }));
    renderScreen();

    fireEvent.click(await screen.findByLabelText("京都旅行 のメニュー"));
    fireEvent.click(await screen.findByText("編集"));
    const title = await screen.findByTestId("album-form-title");
    expect(title).toHaveValue("京都旅行");
    expect(screen.getByTestId("album-form-note")).toHaveValue("紅葉");
    fireEvent.change(title, { target: { value: "京都" } });
    await act(async () => {
      fireEvent.click(screen.getByText("保存"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        { id: "album-1", title: "京都", note: "紅葉", startDate: "2026-08-15", endDate: "2026-08-17" },
        expect.anything(),
      ),
    );
  });
});

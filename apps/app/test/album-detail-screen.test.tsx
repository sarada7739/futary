import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 041: アルバム詳細の画面結合テスト（T11 の詳細側・T15）。album-screen.test.tsx と同じ形
const {
  getMock,
  listMock,
  photoListMock,
  updateMock,
  addPhotosMock,
  removePhotosMock,
  updatePhotoMock,
  uploadUrlMock,
  downloadUrlMock,
  setOptionsMock,
  searchParams,
  pickerLaunchMock,
  compressMock,
  uploadCompressedMock,
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  listMock: vi.fn(),
  photoListMock: vi.fn(),
  updateMock: vi.fn(),
  addPhotosMock: vi.fn(),
  removePhotosMock: vi.fn(),
  updatePhotoMock: vi.fn(),
  uploadUrlMock: vi.fn(),
  downloadUrlMock: vi.fn(),
  setOptionsMock: vi.fn(),
  searchParams: { id: "album-1" as string | undefined },
  pickerLaunchMock: vi.fn(),
  compressMock: vi.fn(),
  uploadCompressedMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useNavigation: () => ({ setOptions: setOptionsMock }),
  useLocalSearchParams: () => searchParams,
}));

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "me", name: "自分", email: "me@example.com", image: null } },
    isPending: false,
  }),
}));

// T15: 圧縮とアップロードを差し替え、2 枚目のアップロードで失敗させる
vi.mock("../lib/image", () => ({
  compressImage: compressMock,
  uploadCompressedImage: uploadCompressedMock,
}));

vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: pickerLaunchMock,
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    album: {
      get: getMock,
      list: listMock,
      update: updateMock,
      addPhotos: addPhotosMock,
      removePhotos: removePhotosMock,
      updatePhoto: updatePhotoMock,
      uploadUrl: uploadUrlMock,
    },
    photo: { list: photoListMock, downloadUrl: downloadUrlMock },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: AlbumDetailScreen } = await import("../app/(tabs)/album-detail");
const { queryClient } = await import("../lib/query");
const { GuestModeContext } = await import("../lib/guest-mode");

function makeAlbum(overrides: Record<string, unknown> = {}) {
  return {
    id: "album-1",
    title: "京都旅行",
    note: "",
    startDate: "2026-08-15",
    endDate: "2026-08-17",
    photoCount: 3,
    cover: { url: "https://example.com/cover.jpg", width: 100, height: 100 },
    createdAt: 1_789_000_000,
    ...overrides,
  };
}

function makeAlbumPhoto(i: number, caption = "") {
  return {
    ref: { kind: "album", photoId: `photo-${i}` },
    url: `https://example.com/a${i}.jpg`,
    width: 100,
    height: 100,
    // 2026-08-16 00:00 JST
    takenAt: Date.UTC(2026, 7, 15, 15, 0, 0) / 1000 + i,
    caption,
  };
}

function makePostPhoto(i: number) {
  return {
    ref: { kind: "post", postId: `post-${i}`, position: 0 },
    url: `https://example.com/t${i}.jpg`,
    width: 100,
    height: 100,
    takenAt: 1_789_000_000 - i,
    caption: `投稿 ${i}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  searchParams.id = "album-1";
  getMock.mockResolvedValue(makeAlbum());
  listMock.mockResolvedValue({ timeline: { photoCount: 2, previews: [] }, items: [] });
  photoListMock.mockImplementation(async (input: { albumId?: string }) =>
    input.albumId
      ? { items: [makeAlbumPhoto(1, "伏見稲荷"), makeAlbumPhoto(2), makeAlbumPhoto(3)], nextCursor: null }
      : { items: [makePostPhoto(1), makePostPhoto(2)], nextCursor: null },
  );
});

function renderScreen(options: { guest?: boolean } = {}) {
  const tree = (
    <QueryClientProvider client={queryClient}>
      <AlbumDetailScreen />
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

type HeaderOptions = { title?: string; headerRight?: () => ReactElement; headerLeft?: () => ReactElement };
function lastHeaderOptions(): HeaderOptions {
  return (setOptionsMock.mock.calls.at(-1)?.[0] as HeaderOptions | undefined) ?? {};
}
function renderHeaderRight(): boolean {
  const options = lastHeaderOptions();
  if (!options.headerRight) return false;
  render(options.headerRight());
  return true;
}

describe("AlbumDetailScreen: 見え方（T11）", () => {
  it("メンバーのアルバム: 見出し 2 行・3 列のグリッド・+・編集・選択がある", async () => {
    renderScreen();

    expect(await screen.findByTestId("album-detail-period")).toHaveTextContent("2026年8月15日 - 8月17日");
    expect(screen.getByTestId("album-detail-summary")).toHaveTextContent("3枚の写真・3日間の思い出");
    expect(screen.getByTestId("album-photo-photo-1")).toBeTruthy();
    expect(screen.getByTestId("album-photo-photo-3")).toBeTruthy();
    expect(screen.getByTestId("album-detail-add")).toBeTruthy();
    expect(lastHeaderOptions().title).toBe("京都旅行");
    expect(renderHeaderRight()).toBe(true);
    expect(screen.getByTestId("album-detail-edit")).toBeTruthy();
    expect(screen.getByTestId("album-detail-select")).toBeTruthy();
  });

  it("期間が無ければ見出しは「N枚の写真」だけ", async () => {
    getMock.mockResolvedValue(makeAlbum({ startDate: null, endDate: null }));
    renderScreen();

    expect(await screen.findByTestId("album-detail-summary")).toHaveTextContent("3枚の写真");
    expect(screen.queryByTestId("album-detail-period")).toBeNull();
  });

  it("ゲストは +・編集・選択が無い（見られる）", async () => {
    renderScreen({ guest: true });

    expect(await screen.findByTestId("album-photo-photo-1")).toBeTruthy();
    expect(screen.queryByTestId("album-detail-add")).toBeNull();
    expect(renderHeaderRight()).toBe(false);
    expect(screen.queryByTestId("album-detail-edit")).toBeNull();
    expect(screen.queryByTestId("album-detail-select")).toBeNull();
  });

  it("タイムライン（id=timeline）は +・編集・選択が無く、題名は「タイムライン」で枚数は album.list から", async () => {
    searchParams.id = "timeline";
    renderScreen();

    expect(await screen.findByTestId("album-photo-post-1:0")).toBeTruthy();
    expect(screen.getByTestId("album-detail-summary")).toHaveTextContent("2枚の写真");
    expect(screen.queryByTestId("album-detail-add")).toBeNull();
    expect(renderHeaderRight()).toBe(false);
    expect(lastHeaderOptions().title).toBe("タイムライン");
    expect(getMock).not.toHaveBeenCalled();
    expect(photoListMock).toHaveBeenCalledWith({ albumId: undefined, cursor: undefined, limit: 60 }, expect.anything());
  });

  it("空のアルバムは「写真を追加しましょう」と +", async () => {
    getMock.mockResolvedValue(makeAlbum({ photoCount: 0, cover: null }));
    photoListMock.mockResolvedValue({ items: [], nextCursor: null });
    renderScreen();

    expect(await screen.findByText("写真を追加しましょう")).toBeTruthy();
    expect(screen.getByTestId("album-detail-add")).toBeTruthy();
  });
});

describe("AlbumDetailScreen: 選択モード（T11）", () => {
  it("選択で選択モードに入り、2 枚選ぶと「カバーにする」が押せない。1 枚なら押せて album.update が呼ばれる", async () => {
    updateMock.mockResolvedValue(makeAlbum());
    renderScreen();
    await screen.findByTestId("album-photo-photo-1");
    renderHeaderRight();
    fireEvent.click(screen.getByTestId("album-detail-select"));

    expect(await screen.findByTestId("album-detail-selection-bar")).toBeTruthy();
    fireEvent.click(screen.getByTestId("album-photo-photo-1"));
    fireEvent.click(screen.getByTestId("album-photo-photo-2"));
    expect(screen.getByTestId("album-photo-check-photo-1")).toBeTruthy();
    expect(screen.getByTestId("album-photo-check-photo-2")).toBeTruthy();
    expect(lastHeaderOptions().title).toBe("2 枚を選択中");
    expect(screen.getByTestId("album-detail-set-cover").getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(screen.getByTestId("album-photo-photo-2"));
    expect(screen.getByTestId("album-detail-set-cover").getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByTestId("album-detail-set-cover"));
      await Promise.resolve();
    });
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ id: "album-1", coverPhotoId: "photo-1" }, expect.anything()));
  });

  it("削除は確認（N 枚を削除しますか？）を挟んで album.removePhotos を呼ぶ", async () => {
    removePhotosMock.mockResolvedValue(makeAlbum({ photoCount: 1 }));
    renderScreen();
    await screen.findByTestId("album-photo-photo-1");
    renderHeaderRight();
    fireEvent.click(screen.getByTestId("album-detail-select"));
    fireEvent.click(await screen.findByTestId("album-photo-photo-1"));
    fireEvent.click(screen.getByTestId("album-photo-photo-3"));
    fireEvent.click(screen.getByTestId("album-detail-remove"));

    expect(await screen.findByText("2 枚を削除しますか？")).toBeTruthy();
    expect(removePhotosMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText("削除する"));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(removePhotosMock).toHaveBeenCalledWith({ id: "album-1", photoIds: ["photo-1", "photo-3"] }, expect.anything()),
    );
  });
});

describe("AlbumDetailScreen: ビューア", () => {
  it("写真を押すとビューアが開き、説明文（アルバム名・日付・本文）と保存ボタンが出る。説明文を押すと入力 → album.updatePhoto", async () => {
    updatePhotoMock.mockResolvedValue(makeAlbumPhoto(1, "新しい説明"));
    renderScreen();
    fireEvent.click(await screen.findByTestId("album-photo-photo-1"));

    const caption = screen.getByTestId("image-viewer-caption");
    expect(caption).toHaveTextContent("京都旅行");
    expect(caption).toHaveTextContent("2026/08/16");
    expect(caption).toHaveTextContent("伏見稲荷");
    expect(screen.getByTestId("image-viewer-download")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("説明を編集"));
    const input = await screen.findByTestId("album-caption-input");
    expect(input).toHaveValue("伏見稲荷");
    fireEvent.change(input, { target: { value: "新しい説明" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("album-caption-save"));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(updatePhotoMock).toHaveBeenCalledWith({ id: "album-1", photoId: "photo-1", caption: "新しい説明" }, expect.anything()),
    );
  });

  it("説明文が空なら「説明を追加」が出る。ゲストには出ず、説明文も押せない", async () => {
    const first = renderScreen();
    fireEvent.click(await screen.findByTestId("album-photo-photo-2"));
    expect(screen.getByText("説明を追加")).toBeTruthy();
    first.unmount();

    queryClient.clear();
    renderScreen({ guest: true });
    fireEvent.click(await screen.findByTestId("album-photo-photo-2"));
    expect(screen.getByTestId("image-viewer-caption")).toHaveTextContent("京都旅行");
    expect(screen.queryByText("説明を追加")).toBeNull();
    expect(screen.queryByLabelText("説明を編集")).toBeNull();
    // 保存はゲストでもできる
    expect(screen.getByTestId("image-viewer-download")).toBeTruthy();
  });
});

describe("AlbumDetailScreen: アップロード（T15）", () => {
  const sources = [
    { uri: "file:///1.jpg", width: 10, height: 10, mimeType: "image/jpeg" },
    { uri: "file:///2.jpg", width: 10, height: 10, mimeType: "image/jpeg" },
    { uri: "file:///3.jpg", width: 10, height: 10, mimeType: "image/jpeg" },
  ];

  it("途中で 1 枚失敗したら album.addPhotos を呼ばず、「送れませんでした」を出す", async () => {
    pickerLaunchMock.mockResolvedValue({ canceled: false, assets: sources });
    compressMock.mockImplementation(async (s: { uri: string }) => ({ uri: s.uri, width: 10, height: 10 }));
    uploadCompressedMock
      .mockResolvedValueOnce({ imageId: "01ARZ3NDEKTSV4RRFFQ69G5FA1", imageWidth: 10, imageHeight: 10 })
      .mockRejectedValueOnce(new Error("画像のアップロードに失敗しました"));
    renderScreen();

    await act(async () => {
      fireEvent.click(await screen.findByTestId("album-detail-add"));
      await Promise.resolve();
    });

    expect(await screen.findByText("送れませんでした。もう一度お試しください")).toBeTruthy();
    expect(uploadCompressedMock).toHaveBeenCalledTimes(2);
    expect(addPhotosMock).not.toHaveBeenCalled();
  });

  it("全部送れたら album.addPhotos を 1 回だけ呼ぶ（枚数ぶんの imageId を並べて）", async () => {
    pickerLaunchMock.mockResolvedValue({ canceled: false, assets: sources });
    compressMock.mockImplementation(async (s: { uri: string }) => ({ uri: s.uri, width: 10, height: 10 }));
    uploadCompressedMock.mockImplementation(async (_req: unknown, c: { uri: string }) => ({
      imageId: `01ARZ3NDEKTSV4RRFFQ69G5FA${c.uri.slice(-5, -4)}`,
      imageWidth: 10,
      imageHeight: 10,
    }));
    addPhotosMock.mockResolvedValue(makeAlbum({ photoCount: 6 }));
    renderScreen();

    await act(async () => {
      fireEvent.click(await screen.findByTestId("album-detail-add"));
      await Promise.resolve();
    });

    await waitFor(() => expect(addPhotosMock).toHaveBeenCalledTimes(1));
    expect(addPhotosMock).toHaveBeenCalledWith(
      {
        id: "album-1",
        photos: [
          { imageId: "01ARZ3NDEKTSV4RRFFQ69G5FA1", width: 10, height: 10 },
          { imageId: "01ARZ3NDEKTSV4RRFFQ69G5FA2", width: 10, height: 10 },
          { imageId: "01ARZ3NDEKTSV4RRFFQ69G5FA3", width: 10, height: 10 },
        ],
      },
      expect.anything(),
    );
    expect(screen.queryByText("送れませんでした。もう一度お試しください")).toBeNull();
  });
});

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
  coupleGetMock,
  pushMock,
  setOptionsMock,
  searchParams,
  pickerLaunchMock,
  compressMock,
  uploadCompressedMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  getMock: vi.fn(),
  listMock: vi.fn(),
  photoListMock: vi.fn(),
  updateMock: vi.fn(),
  addPhotosMock: vi.fn(),
  removePhotosMock: vi.fn(),
  updatePhotoMock: vi.fn(),
  uploadUrlMock: vi.fn(),
  downloadUrlMock: vi.fn(),
  coupleGetMock: vi.fn(),
  setOptionsMock: vi.fn(),
  searchParams: { id: "album-1" as string | undefined },
  pickerLaunchMock: vi.fn(),
  compressMock: vi.fn(),
  uploadCompressedMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
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
    // 045: 詳細は couple.get から無料枠を読む（既定は paid = 枠なし。T7 のテストで free に上書きする）
    couple: { get: coupleGetMock },
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
  // 045: 警告の × の「消した」は sessionStorage。テスト間で持ち越さない
  window.sessionStorage.clear();
  searchParams.id = "album-1";
  getMock.mockResolvedValue(makeAlbum());
  coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "paid", albumQuota: null });
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

describe("AlbumDetailScreen: 100 枚を超える削除（R の段階1レビュー）", () => {
  it("101 枚選んで削除すると album.removePhotos が 100 枚 + 1 枚の 2 回に分かれて呼ばれる", async () => {
    const many = Array.from({ length: 101 }, (_, i) => makeAlbumPhoto(i + 1));
    photoListMock.mockResolvedValue({ items: many, nextCursor: null });
    getMock.mockResolvedValue(makeAlbum({ photoCount: 101 }));
    removePhotosMock.mockResolvedValue(makeAlbum({ photoCount: 0 }));
    renderScreen();
    await screen.findByTestId("album-photo-photo-101");
    renderHeaderRight();
    fireEvent.click(screen.getByTestId("album-detail-select"));
    await screen.findByTestId("album-detail-selection-bar");
    for (let i = 1; i <= 101; i++) fireEvent.click(screen.getByTestId(`album-photo-photo-${i}`));
    expect(lastHeaderOptions().title).toBe("101 枚を選択中");
    fireEvent.click(screen.getByTestId("album-detail-remove"));
    await act(async () => {
      fireEvent.click(await screen.findByText("削除する"));
      await Promise.resolve();
    });

    await waitFor(() => expect(removePhotosMock).toHaveBeenCalledTimes(2));
    const calls = removePhotosMock.mock.calls.map((c) => (c[0] as { photoIds: string[] }).photoIds.length);
    expect(calls).toEqual([100, 1]);
    // 101 回のクリックは全体実行のときに既定の 5 秒を超えることがある（単体では 1 秒台）
  }, 20_000);
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

// react-native-web の Modal（animationType="fade"）は閉じるとき animationend を待ってから DOM から消す。
// jsdom はアニメーションを実行しないので手で発火する（home-releases.test.tsx と同じ）
function finishModalAnimations() {
  for (const node of Array.from(document.body.querySelectorAll("*"))) {
    node.dispatchEvent(new Event("webkitAnimationEnd", { bubbles: true }));
    node.dispatchEvent(new Event("animationend", { bubbles: true }));
  }
}

// 045・T7: 無料枠。枠は couple.get の albumQuota から。paid（null）なら枠の行が無く、FAB は今までどおり
describe("AlbumDetailScreen: 無料枠（045）", () => {
  const sources = [
    { uri: "file:///1.jpg", width: 10, height: 10, mimeType: "image/jpeg" },
    { uri: "file:///2.jpg", width: 10, height: 10, mimeType: "image/jpeg" },
    { uri: "file:///3.jpg", width: 10, height: 10, mimeType: "image/jpeg" },
  ];

  it("free のとき見出しの下に「26 / 30 枚」。上限なら「30 / 30 枚 - 上限に達しています」", async () => {
    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 26 } });
    const first = renderScreen();
    expect(await screen.findByTestId("album-detail-quota")).toHaveTextContent("26 / 30 枚");
    expect(screen.getByTestId("album-detail-quota")).not.toHaveTextContent("上限");
    first.unmount();

    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 30 } });
    queryClient.clear();
    renderScreen();
    expect(await screen.findByTestId("album-detail-quota")).toHaveTextContent("30 / 30 枚 - 上限に達しています");
  });

  it("残り 5 で FAB の上に警告のカード（「残り 5 枚です」「あと 5 枚で上限（無料プラン 30 枚）に達します」）。残り 6 では出ない", async () => {
    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 25 } });
    const first = renderScreen();
    expect(await screen.findByTestId("album-quota-warning")).toBeTruthy();
    expect(screen.getByTestId("album-quota-warning-title")).toHaveTextContent("残り 5 枚です");
    expect(screen.getByTestId("album-quota-warning-body")).toHaveTextContent("あと 5 枚で上限（無料プラン 30 枚）に達します");
    fireEvent.click(screen.getByTestId("album-quota-warning-premium"));
    expect(pushMock).toHaveBeenCalledWith("/premium");
    first.unmount();

    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 24 } });
    queryClient.clear();
    renderScreen();
    expect(await screen.findByTestId("album-detail-quota")).toHaveTextContent("24 / 30 枚");
    expect(screen.queryByTestId("album-quota-warning")).toBeNull();
  });

  // 人間の指示（2026-09-14）: 警告のカードは × で消せる。消した状態はこの起動の間（sessionStorage）。
  // 残り枚数が変われば（写真を足したら）もう一度出す
  it("警告の × で消える。開き直しても同じ残り枚数なら出ない。残りが減ればまた出る", async () => {
    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 26 } });
    const first = renderScreen();
    expect(await screen.findByTestId("album-quota-warning")).toBeTruthy();

    fireEvent.click(screen.getByTestId("album-quota-warning-close"));
    await waitFor(() => expect(screen.queryByTestId("album-quota-warning")).toBeNull());
    // 「27 / 30 枚」の行と FAB はそのまま（消えるのは警告のカードだけ）
    expect(screen.getByTestId("album-detail-quota")).toHaveTextContent("26 / 30 枚");
    expect(screen.getByTestId("album-detail-add")).toBeTruthy();
    first.unmount();

    // 開き直し（同じ残り 4 枚）: 出ない
    queryClient.clear();
    const second = renderScreen();
    expect(await screen.findByTestId("album-detail-quota")).toHaveTextContent("26 / 30 枚");
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("album-quota-warning")).toBeNull();
    second.unmount();

    // 写真を足して残り 3 枚: また出る
    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 27 } });
    queryClient.clear();
    renderScreen();
    expect(await screen.findByTestId("album-quota-warning")).toBeTruthy();
    expect(screen.getByTestId("album-quota-warning-title")).toHaveTextContent("残り 3 枚です");
  });

  it("paid のとき枠の行は無い。ゲスト・タイムラインにも無い", async () => {
    const first = renderScreen();
    await screen.findByTestId("album-detail-add");
    expect(screen.queryByTestId("album-detail-quota")).toBeNull();
    first.unmount();

    coupleGetMock.mockClear();
    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 0 } });
    queryClient.clear();
    renderScreen({ guest: true });
    await screen.findByTestId("album-detail-cover");
    expect(screen.queryByTestId("album-detail-quota")).toBeNull();
    // ゲストは couple.get を読まない（書けないので枠が要らない）
    expect(coupleGetMock).not.toHaveBeenCalled();
  });

  it("残り 0 のとき FAB を押すとシートが出て、写真を選ばない", async () => {
    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 30 } });
    pickerLaunchMock.mockResolvedValue({ canceled: false, assets: sources });
    renderScreen();
    expect(await screen.findByTestId("album-detail-quota")).toHaveTextContent("上限に達しています");

    await act(async () => {
      fireEvent.click(screen.getByTestId("album-detail-add"));
      await Promise.resolve();
    });

    expect(await screen.findByTestId("plan-limit-sheet")).toBeTruthy();
    expect(screen.getByTestId("plan-limit-title")).toHaveTextContent("写真の上限に達しました");
    expect(screen.getByTestId("plan-limit-message")).toHaveTextContent("大切な思い出をもっと残すために、プレミアムプランへ。");
    expect(screen.getByTestId("plan-limit-free-line")).toHaveTextContent("30 枚まで保存可能");
    expect(screen.getByTestId("plan-limit-premium-line")).toHaveTextContent("写真枚数 無制限");
    // 価格・トライアル・存在しない機能は書かない
    expect(screen.queryByText(/トライアル/)).toBeNull();
    expect(screen.queryByText(/¥/)).toBeNull();
    expect(screen.queryByText(/アルバムグループ/)).toBeNull();
    expect(pickerLaunchMock).not.toHaveBeenCalled();
    expect(addPhotosMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("plan-limit-close"));
    act(() => finishModalAnimations());
    await waitFor(() => expect(screen.queryByTestId("plan-limit-sheet")).toBeNull());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("上限のシートの「プレミアムプランを見る ›」で /premium へ進む（シートは閉じる）", async () => {
    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 30 } });
    renderScreen();
    await screen.findByTestId("album-detail-quota");
    await act(async () => {
      fireEvent.click(screen.getByTestId("album-detail-add"));
      await Promise.resolve();
    });
    fireEvent.click(await screen.findByTestId("plan-limit-premium"));
    expect(pushMock).toHaveBeenCalledWith("/premium");
    act(() => finishModalAnimations());
    await waitFor(() => expect(screen.queryByTestId("plan-limit-sheet")).toBeNull());
  });

  it("残り 2 で 3 枚選ぶと「あと 2 枚まで入れられます」で止まり、送らない", async () => {
    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 28 } });
    pickerLaunchMock.mockResolvedValue({ canceled: false, assets: sources });
    renderScreen();
    expect(await screen.findByTestId("album-detail-quota")).toHaveTextContent("28 / 30 枚");
    expect(screen.getByTestId("album-quota-warning-title")).toHaveTextContent("残り 2 枚です");

    await act(async () => {
      fireEvent.click(screen.getByTestId("album-detail-add"));
      await Promise.resolve();
    });

    expect(await screen.findByText("あと 2 枚まで入れられます")).toBeTruthy();
    expect(uploadCompressedMock).not.toHaveBeenCalled();
    expect(addPhotosMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("plan-limit-message")).toBeNull();
  });

  it("残り 3 で 3 枚選ぶと送る（ちょうど枠いっぱいは入る）", async () => {
    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 27 } });
    pickerLaunchMock.mockResolvedValue({ canceled: false, assets: sources });
    compressMock.mockImplementation(async (s: { uri: string }) => ({ uri: s.uri, width: 10, height: 10 }));
    uploadCompressedMock.mockImplementation(async (_req: unknown, c: { uri: string }) => ({
      imageId: `01ARZ3NDEKTSV4RRFFQ69G5FA${c.uri.slice(-5, -4)}`,
      imageWidth: 10,
      imageHeight: 10,
    }));
    addPhotosMock.mockResolvedValue(makeAlbum({ photoCount: 6 }));
    renderScreen();
    await screen.findByTestId("album-detail-quota");

    await act(async () => {
      fireEvent.click(screen.getByTestId("album-detail-add"));
      await Promise.resolve();
    });

    await waitFor(() => expect(addPhotosMock).toHaveBeenCalledTimes(1));
  });

  it("サーバが PLAN_LIMIT を返したら（相手が同時に足した等）同じシート", async () => {
    const { ORPCError } = await import("@orpc/client");
    coupleGetMock.mockResolvedValue({ id: "couple-1", plan: "free", albumQuota: { limit: 30, used: 27 } });
    pickerLaunchMock.mockResolvedValue({ canceled: false, assets: sources });
    compressMock.mockImplementation(async (s: { uri: string }) => ({ uri: s.uri, width: 10, height: 10 }));
    uploadCompressedMock.mockImplementation(async (_req: unknown, c: { uri: string }) => ({
      imageId: `01ARZ3NDEKTSV4RRFFQ69G5FA${c.uri.slice(-5, -4)}`,
      imageWidth: 10,
      imageHeight: 10,
    }));
    addPhotosMock.mockRejectedValue(new ORPCError("PLAN_LIMIT", { status: 409 }));
    renderScreen();
    await screen.findByTestId("album-detail-quota");

    await act(async () => {
      fireEvent.click(screen.getByTestId("album-detail-add"));
      await Promise.resolve();
    });

    expect(await screen.findByTestId("plan-limit-message")).toBeTruthy();
    expect(screen.queryByText("送れませんでした。もう一度お試しください")).toBeNull();
  });
});

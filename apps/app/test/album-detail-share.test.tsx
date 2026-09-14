import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 042: 選択モードの「保存」（T1・T2・T4・T5・T6 の画面側。ラベルは「保存」「カバー」「削除」。上限は「保存」に掛ける。1節）。album-detail-screen.test.tsx と同じ形。
// jsdom の navigator に canShare / share は無い（= PC）。共有シートのある環境（iPhone・Android）は
// テストごとに生やして、終わったら消す。ロジック側（File の中身・順序）は share-photos.test.ts
const { getMock, listMock, photoListMock, downloadUrlMock, setOptionsMock, searchParams } = vi.hoisted(() => ({
  getMock: vi.fn(),
  listMock: vi.fn(),
  photoListMock: vi.fn(),
  downloadUrlMock: vi.fn(),
  setOptionsMock: vi.fn(),
  searchParams: { id: "album-1" as string | undefined },
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

// アップロードの経路はこのテストでは使わない（album-detail が import するので差し替えだけ）
vi.mock("../lib/image", () => ({ compressImage: vi.fn(), uploadCompressedImage: vi.fn() }));
vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: vi.fn(),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    album: {
      get: getMock,
      list: listMock,
      update: vi.fn(),
      addPhotos: vi.fn(),
      removePhotos: vi.fn(),
      updatePhoto: vi.fn(),
      uploadUrl: vi.fn(),
    },
    photo: { list: photoListMock, downloadUrl: downloadUrlMock },
    // 045: 詳細は couple.get から無料枠を読む。このテストは保存の話なので paid（枠の行なし）に固定
    couple: { get: vi.fn(async () => ({ id: "couple-1", plan: "paid", albumQuota: null })) },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: AlbumDetailScreen } = await import("../app/(tabs)/album-detail");
const { queryClient } = await import("../lib/query");
const { GuestModeContext } = await import("../lib/guest-mode");

type Ref = { kind: "album"; photoId: string } | { kind: "post"; postId: string; position: number };

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

function makeAlbumPhoto(i: number) {
  return {
    ref: { kind: "album", photoId: `photo-${i}` },
    url: `https://example.com/a${i}.jpg`,
    width: 100,
    height: 100,
    takenAt: Date.UTC(2026, 7, 15, 15, 0, 0) / 1000 + i,
    caption: "",
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

function idOf(ref: Ref): string {
  return ref.kind === "album" ? ref.photoId : `${ref.postId}-${ref.position}`;
}
function urlOf(ref: Ref): string {
  return `https://r2.example.com/${idOf(ref)}?response-content-disposition=attachment`;
}
function filenameOf(ref: Ref): string {
  return `nisoine-20260816-${idOf(ref)}.jpg`;
}

type NavShare = { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };
const nav = navigator as Navigator & NavShare;
type ShareMock = ReturnType<typeof vi.fn<(d: ShareData) => Promise<void>>>;
// 共有シートのある環境にする（canShare 真）。レンダー前に呼ぶ（判定は起動時に 1 回）
function enableShareSheet(share: ShareMock = vi.fn(async () => {})): ShareMock {
  nav.canShare = () => true;
  nav.share = share;
  return share;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  searchParams.id = "album-1";
  getMock.mockResolvedValue(makeAlbum());
  listMock.mockResolvedValue({ timeline: { photoCount: 2, previews: [] }, items: [] });
  photoListMock.mockImplementation(async (input: { albumId?: string }) =>
    input.albumId
      ? { items: [makeAlbumPhoto(1), makeAlbumPhoto(2), makeAlbumPhoto(3)], nextCursor: null }
      : { items: [makePostPhoto(1), makePostPhoto(2)], nextCursor: null },
  );
  downloadUrlMock.mockImplementation(async (ref: Ref) => ({ url: urlOf(ref), filename: filenameOf(ref) }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  const bag = nav as unknown as Record<string, unknown>;
  Reflect.deleteProperty(bag, "canShare");
  Reflect.deleteProperty(bag, "share");
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

type HeaderOptions = { title?: string; headerRight?: () => ReactElement };
function lastHeaderOptions(): HeaderOptions {
  return (setOptionsMock.mock.calls.at(-1)?.[0] as HeaderOptions | undefined) ?? {};
}
function renderHeaderRight(): boolean {
  const options = lastHeaderOptions();
  if (!options.headerRight) return false;
  render(options.headerRight());
  return true;
}

// 写真が並んだあと「選択」を押して選択モードに入る
async function enterSelection(firstPhotoTestId: string) {
  await screen.findByTestId(firstPhotoTestId);
  expect(renderHeaderRight()).toBe(true);
  fireEvent.click(screen.getByTestId("album-detail-select"));
  await screen.findByTestId("album-detail-selection-bar");
}

async function pressShare() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("album-detail-share"));
    await Promise.resolve();
  });
}

function sharedFileNames(share: ShareMock): string[] {
  return share.mock.calls[0]![0].files!.map((f) => f.name);
}

describe("AlbumDetailScreen: 選択モードの「保存」（042 T1）", () => {
  it("共有シートが無い環境（PC・jsdom の既定）では選択モードに「保存」が無く、カバー・削除はある", async () => {
    renderScreen();
    await enterSelection("album-photo-photo-1");

    expect(screen.queryByTestId("album-detail-share")).toBeNull();
    expect(screen.getByTestId("album-detail-set-cover")).toBeTruthy();
    expect(screen.getByTestId("album-detail-remove")).toBeTruthy();
  });

  it("共有シートがある環境では「保存」が出る。0 枚では押せず、選ぶと押せる（枚数はヘッダー）。カバー・削除も残る", async () => {
    enableShareSheet();
    renderScreen();
    await enterSelection("album-photo-photo-1");

    const share = screen.getByTestId("album-detail-share");
    expect(share).toHaveTextContent("保存");
    expect(share.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByTestId("album-photo-photo-1"));
    fireEvent.click(screen.getByTestId("album-photo-photo-2"));
    expect(lastHeaderOptions().title).toBe("2 枚を選択中");
    expect(screen.getByTestId("album-detail-share").getAttribute("aria-disabled")).not.toBe("true");
    expect(screen.getByTestId("album-detail-set-cover")).toHaveTextContent("カバー");
    expect(screen.getByTestId("album-detail-remove")).toBeTruthy();
  });
});

describe("AlbumDetailScreen: 20 枚の上限（042 T2）", () => {
  it("21 枚以上選ぶと「保存」が押せず 1 行が出る（押しても share は呼ばれない）。削除は押せる。20 枚に戻すと「保存」が押せる", async () => {
    const share = enableShareSheet();
    photoListMock.mockResolvedValue({ items: Array.from({ length: 25 }, (_, i) => makeAlbumPhoto(i + 1)), nextCursor: null });
    getMock.mockResolvedValue(makeAlbum({ photoCount: 25 }));
    renderScreen();
    await enterSelection("album-photo-photo-25");

    for (let i = 1; i <= 21; i++) fireEvent.click(screen.getByTestId(`album-photo-photo-${i}`));

    // 選択には上限が無い（削除・カバーと共用）
    expect(lastHeaderOptions().title).toBe("21 枚を選択中");
    expect(screen.getByTestId("album-photo-check-photo-21")).toBeTruthy();
    expect(screen.getByTestId("album-detail-share").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("album-detail-share-limit")).toHaveTextContent("一度に保存できるのは 20 枚までです");
    expect(screen.getByTestId("album-detail-remove").getAttribute("aria-disabled")).not.toBe("true");
    await pressShare();
    expect(share).not.toHaveBeenCalled();
    expect(downloadUrlMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("album-photo-photo-21"));
    expect(lastHeaderOptions().title).toBe("20 枚を選択中");
    expect(screen.getByTestId("album-detail-share").getAttribute("aria-disabled")).not.toBe("true");
    expect(screen.queryByTestId("album-detail-share-limit")).toBeNull();
  });
  // 共有シートが無い環境（PC）は「保存」自体が無い。選択に上限が無いことは album-detail-screen.test.tsx の「101 枚選んで削除」がそのまま緑
});

describe("AlbumDetailScreen: 保存を押す（042 T3・T4・T5）", () => {
  it("T3: 選んだ写真を表示順に取得し、File の数・名前・型が一致する形で共有シートを 1 回出す。終わったら選択モードを抜ける", async () => {
    const share = enableShareSheet();
    renderScreen();
    await enterSelection("album-photo-photo-1");
    // 選んだ順は 3 → 1 でも、渡す順は表示順（1 → 3）
    fireEvent.click(screen.getByTestId("album-photo-photo-3"));
    fireEvent.click(screen.getByTestId("album-photo-photo-1"));

    await pressShare();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(downloadUrlMock.mock.calls.map((c) => c[0])).toEqual([
      { kind: "album", photoId: "photo-1" },
      { kind: "album", photoId: "photo-3" },
    ]);
    const files = share.mock.calls[0]![0].files!;
    expect(files.map((f) => f.name)).toEqual(["nisoine-20260816-photo-1.jpg", "nisoine-20260816-photo-3.jpg"]);
    expect(files.map((f) => f.type)).toEqual(["image/jpeg", "image/jpeg"]);
    expect(files.map((f) => f.size)).toEqual([3, 3]);
    await waitFor(() => expect(screen.queryByTestId("album-detail-selection-bar")).toBeNull());
    expect(screen.queryByText(/できませんでした/)).toBeNull();
    expect(screen.queryByTestId("album-detail-share-progress")).toBeNull();
  });

  it("T4: 1 枚の fetch が失敗しても残りで共有シートが出て、閉じたあとに「1 枚は取得できませんでした」", async () => {
    const share = enableShareSheet();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("photo-2") ? new Response("", { status: 404 }) : new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 }),
      ),
    );
    renderScreen();
    await enterSelection("album-photo-photo-1");
    fireEvent.click(screen.getByTestId("album-photo-photo-1"));
    fireEvent.click(screen.getByTestId("album-photo-photo-2"));
    fireEvent.click(screen.getByTestId("album-photo-photo-3"));

    await pressShare();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(sharedFileNames(share)).toEqual(["nisoine-20260816-photo-1.jpg", "nisoine-20260816-photo-3.jpg"]);
    expect(await screen.findByText("1 枚は取得できませんでした")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("album-detail-selection-bar")).toBeNull());
  });

  it("T4: 1 枚も取得できなければ共有シートを出さず「取得できませんでした」。選択は残る", async () => {
    const share = enableShareSheet();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    renderScreen();
    await enterSelection("album-photo-photo-1");
    fireEvent.click(screen.getByTestId("album-photo-photo-1"));

    await pressShare();

    expect(await screen.findByText("取得できませんでした。もう一度お試しください")).toBeTruthy();
    expect(share).not.toHaveBeenCalled();
    expect(screen.getByTestId("album-detail-selection-bar")).toBeTruthy();
    expect(screen.getByTestId("album-photo-check-photo-1")).toBeTruthy();
  });

  it("T5: 共有シートを閉じた（AbortError）ときは何も出ず、選択が残り、もう一度押せる", async () => {
    const share = enableShareSheet(
      vi.fn(async () => {
        throw new DOMException("closed", "AbortError");
      }),
    );
    renderScreen();
    await enterSelection("album-photo-photo-1");
    fireEvent.click(screen.getByTestId("album-photo-photo-1"));
    fireEvent.click(screen.getByTestId("album-photo-photo-2"));

    await pressShare();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("album-detail-share-progress")).toBeNull());
    expect(screen.getByTestId("album-detail-selection-bar")).toBeTruthy();
    expect(screen.getByTestId("album-photo-check-photo-1")).toBeTruthy();
    expect(screen.getByTestId("album-photo-check-photo-2")).toBeTruthy();
    expect(lastHeaderOptions().title).toBe("2 枚を選択中");
    expect(screen.queryByText(/できませんでした/)).toBeNull();
    expect(screen.getByTestId("album-detail-share").getAttribute("aria-disabled")).not.toBe("true");
  });

  it("share が AbortError 以外（NotAllowedError）で失敗したら「保存できませんでした」。選択は残る", async () => {
    const share = enableShareSheet(
      vi.fn(async () => {
        throw new DOMException("not allowed", "NotAllowedError");
      }),
    );
    renderScreen();
    await enterSelection("album-photo-photo-1");
    fireEvent.click(screen.getByTestId("album-photo-photo-1"));

    await pressShare();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("保存できませんでした。もう一度お試しください")).toBeTruthy();
    expect(screen.getByTestId("album-photo-check-photo-1")).toBeTruthy();
  });
});

describe("AlbumDetailScreen: タイムライン・ゲストの選択モード（042 T6）", () => {
  it("タイムラインは共有シートがあれば「選択」が出て、選択モードは「保存」だけ（カバー・削除・編集・+ が無い）", async () => {
    const share = enableShareSheet();
    searchParams.id = "timeline";
    renderScreen();
    await enterSelection("album-photo-post-1:0");

    expect(screen.queryByTestId("album-detail-edit")).toBeNull();
    expect(screen.queryByTestId("album-detail-add")).toBeNull();
    expect(screen.getByTestId("album-detail-share")).toBeTruthy();
    expect(screen.queryByTestId("album-detail-set-cover")).toBeNull();
    expect(screen.queryByTestId("album-detail-remove")).toBeNull();

    fireEvent.click(screen.getByTestId("album-photo-post-1:0"));
    fireEvent.click(screen.getByTestId("album-photo-post-2:0"));
    expect(lastHeaderOptions().title).toBe("2 枚を選択中");
    await pressShare();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(downloadUrlMock.mock.calls.map((c) => c[0])).toEqual([
      { kind: "post", postId: "post-1", position: 0 },
      { kind: "post", postId: "post-2", position: 0 },
    ]);
    expect(sharedFileNames(share)).toEqual(["nisoine-20260816-post-1-0.jpg", "nisoine-20260816-post-2-0.jpg"]);
  });

  it("ゲストのアルバムも「保存」だけ（編集・カバー・削除・+ が無い）", async () => {
    enableShareSheet();
    renderScreen({ guest: true });
    await enterSelection("album-photo-photo-1");

    expect(screen.queryByTestId("album-detail-edit")).toBeNull();
    expect(screen.queryByTestId("album-detail-add")).toBeNull();
    expect(screen.getByTestId("album-detail-share")).toBeTruthy();
    expect(screen.queryByTestId("album-detail-set-cover")).toBeNull();
    expect(screen.queryByTestId("album-detail-remove")).toBeNull();
  });
  // 共有シートが無い環境ではタイムライン・ゲストに「選択」が出ない（今までどおり）:
  // album-detail-screen.test.tsx の「ゲストは +・編集・選択が無い」「タイムラインは +・編集・選択が無い」がそのまま緑
});

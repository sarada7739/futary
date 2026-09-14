import { beforeEach, describe, expect, it, vi } from "vitest";

// 049: 20 枚ずつ addPhotos を呼ぶ一括アップロード（T1・T2・T4 のロジック側）。
// 画面側（確認・やめる・101 枚目の 1 行・無料枠）は album-detail-screen.test.tsx
const { compressMock, uploadCompressedMock } = vi.hoisted(() => ({ compressMock: vi.fn(), uploadCompressedMock: vi.fn() }));
vi.mock("../lib/image", () => ({ compressImage: compressMock, uploadCompressedImage: uploadCompressedMock }));
vi.mock("expo-image-picker", () => ({ requestMediaLibraryPermissionsAsync: vi.fn(), launchImageLibraryAsync: vi.fn() }));

const { ALBUM_UPLOAD_BATCH_MAX, uploadAlbumImagesInBatches } = await import("../lib/album-upload");

function sources(count: number) {
  return Array.from({ length: count }, (_, i) => ({ uri: `file:///${i + 1}.jpg`, width: 10, height: 10, mimeType: "image/jpeg" }));
}
const requestUploadUrl = vi.fn(async () => ({ imageId: "x", url: "https://r2.example.com/x" }));
let addPhotosMock: ReturnType<typeof vi.fn<(uploaded: { imageId: string }[]) => Promise<unknown>>>;

beforeEach(() => {
  vi.clearAllMocks();
  compressMock.mockImplementation(async (s: { uri: string }) => ({ uri: s.uri, width: 10, height: 10 }));
  uploadCompressedMock.mockImplementation(async (_req: unknown, c: { uri: string }) => ({
    imageId: `id-${c.uri.replace(/\D/g, "")}`,
    imageWidth: 10,
    imageHeight: 10,
  }));
  addPhotosMock = vi.fn(async () => ({}));
});

describe("uploadAlbumImagesInBatches（049）", () => {
  it("一度に選べるのは 100 枚（定数）", () => {
    expect(ALBUM_UPLOAD_BATCH_MAX).toBe(100);
  });

  it("T1: 45 枚 → addPhotos が 20・20・5 の 3 回、選んだ順。進捗は 0 → 45 を 1 枚ずつ", async () => {
    const progress: number[] = [];

    const result = await uploadAlbumImagesInBatches(sources(45), requestUploadUrl, addPhotosMock, { onProgress: (p) => progress.push(p.done) });

    expect(result).toEqual({ added: 45, failed: 0, aborted: false });
    expect(addPhotosMock.mock.calls.map((c) => c[0].length)).toEqual([20, 20, 5]);
    const ids = addPhotosMock.mock.calls.flatMap((c) => c[0].map((u) => u.imageId));
    expect(ids).toEqual(Array.from({ length: 45 }, (_, i) => `id-${i + 1}`));
    // 圧縮・PUT は 1 枚ずつ直列（呼び出しの順が選んだ順）
    expect(compressMock.mock.calls.map((c) => (c[0] as { uri: string }).uri)).toEqual(sources(45).map((s) => s.uri));
    expect(progress).toEqual(Array.from({ length: 46 }, (_, i) => i));
  });

  it("T2: 2 つ目の塊の PUT が 1 枚失敗 → 1 つ目と 3 つ目は入り、2 つ目は addPhotos を呼ばない。failed は 20", async () => {
    uploadCompressedMock.mockImplementation(async (_req: unknown, c: { uri: string }) => {
      if (c.uri === "file:///25.jpg") throw new Error("画像のアップロードに失敗しました");
      return { imageId: `id-${c.uri.replace(/\D/g, "")}`, imageWidth: 10, imageHeight: 10 };
    });
    const progress: number[] = [];

    const result = await uploadAlbumImagesInBatches(sources(45), requestUploadUrl, addPhotosMock, { onProgress: (p) => progress.push(p.done) });

    expect(result).toEqual({ added: 25, failed: 20, aborted: false });
    expect(addPhotosMock.mock.calls.map((c) => c[0].length)).toEqual([20, 5]);
    expect(addPhotosMock.mock.calls[1]![0][0]!.imageId).toBe("id-41");
    // 失敗した塊の残り（26〜40 枚目）は送らない
    expect(uploadCompressedMock).toHaveBeenCalledTimes(20 + 5 + 5);
    // 進捗は失敗した塊の分も進めて最後は 45
    expect(progress.at(-1)).toBe(45);
  });

  it("T2: addPhotos が失敗した塊も入らず、残りの塊は続ける（stopOn に当たるものだけ投げ直す）", async () => {
    addPhotosMock.mockRejectedValueOnce(new Error("network")).mockResolvedValue({});

    const result = await uploadAlbumImagesInBatches(sources(45), requestUploadUrl, addPhotosMock);

    expect(result).toEqual({ added: 25, failed: 20, aborted: false });
    expect(addPhotosMock).toHaveBeenCalledTimes(3);
  });

  it("stopOn に当たる失敗（PLAN_LIMIT）は残りの塊を送らずに投げ直す", async () => {
    const planLimit = Object.assign(new Error("plan"), { code: "PLAN_LIMIT" });
    addPhotosMock.mockRejectedValueOnce(planLimit);

    await expect(
      uploadAlbumImagesInBatches(sources(45), requestUploadUrl, addPhotosMock, {
        stopOn: (e) => (e as { code?: string }).code === "PLAN_LIMIT",
      }),
    ).rejects.toBe(planLimit);
    expect(addPhotosMock).toHaveBeenCalledTimes(1);
    expect(uploadCompressedMock).toHaveBeenCalledTimes(20);
  });

  it("T4: 途中で閉じると以後の PUT を始めず aborted。送り終えた塊は残る（added は 20）", async () => {
    const controller = new AbortController();
    uploadCompressedMock.mockImplementation(async (_req: unknown, c: { uri: string }) => {
      // 27 枚目の PUT の途中で閉じる
      if (c.uri === "file:///27.jpg") controller.abort();
      return { imageId: `id-${c.uri.replace(/\D/g, "")}`, imageWidth: 10, imageHeight: 10 };
    });

    const result = await uploadAlbumImagesInBatches(sources(45), requestUploadUrl, addPhotosMock, { signal: controller.signal });

    expect(result).toEqual({ added: 20, failed: 0, aborted: true });
    expect(addPhotosMock).toHaveBeenCalledTimes(1);
    expect(uploadCompressedMock).toHaveBeenCalledTimes(27);
  });

  it("T4: 塊の PUT が全部済んでから閉じられても、その塊の addPhotos は呼ぶ（送り終えた塊は残す）", async () => {
    const controller = new AbortController();
    uploadCompressedMock.mockImplementation(async (_req: unknown, c: { uri: string }) => {
      if (c.uri === "file:///20.jpg") controller.abort();
      return { imageId: `id-${c.uri.replace(/\D/g, "")}`, imageWidth: 10, imageHeight: 10 };
    });

    const result = await uploadAlbumImagesInBatches(sources(45), requestUploadUrl, addPhotosMock, { signal: controller.signal });

    expect(result).toEqual({ added: 20, failed: 0, aborted: true });
    expect(addPhotosMock).toHaveBeenCalledTimes(1);
    expect(uploadCompressedMock).toHaveBeenCalledTimes(20);
  });

  it("20 枚以下は 1 回の addPhotos（041 のまま）。0 枚は何も呼ばない", async () => {
    expect(await uploadAlbumImagesInBatches(sources(3), requestUploadUrl, addPhotosMock)).toEqual({ added: 3, failed: 0, aborted: false });
    expect(addPhotosMock).toHaveBeenCalledTimes(1);
    expect(await uploadAlbumImagesInBatches([], requestUploadUrl, addPhotosMock)).toEqual({ added: 0, failed: 0, aborted: false });
    expect(addPhotosMock).toHaveBeenCalledTimes(1);
  });
});

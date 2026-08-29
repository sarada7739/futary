import { beforeEach, describe, expect, it, vi } from "vitest";

// expo-image-manipulator はネイティブモジュールで、ユニットテストでは実際の
// 画像処理を検証できない。resize/saveAsync に渡された引数（長辺の縮小先・
// JPEG品質）が正しいことをモックで検証する
const { resizeMock, renderAsyncMock, saveAsyncMock, manipulateMock } = vi.hoisted(() => {
  const saveAsyncMock = vi.fn();
  const renderAsyncMock = vi.fn();
  const resizeMock = vi.fn();
  const manipulateMock = vi.fn();
  return { resizeMock, renderAsyncMock, saveAsyncMock, manipulateMock };
});

vi.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: manipulateMock },
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

import { compressImage, UnsupportedImageTypeError, uploadCompressedImage } from "../lib/image";

beforeEach(() => {
  vi.clearAllMocks();
  const context = { resize: resizeMock, renderAsync: renderAsyncMock };
  resizeMock.mockReturnValue(context);
  manipulateMock.mockReturnValue(context);
  renderAsyncMock.mockResolvedValue({ saveAsync: saveAsyncMock });
  saveAsyncMock.mockResolvedValue({ uri: "file:///compressed.jpg", width: 1600, height: 900 });
});

describe("compressImage", () => {
  it("長辺が1600pxを超える横長画像は width:1600 に resize される", async () => {
    await compressImage({ uri: "file:///a.jpg", width: 3200, height: 1800, mimeType: "image/jpeg" });

    expect(manipulateMock).toHaveBeenCalledWith("file:///a.jpg");
    expect(resizeMock).toHaveBeenCalledWith({ width: 1600 });
  });

  it("長辺が1600pxを超える縦長画像は height:1600 に resize される", async () => {
    await compressImage({ uri: "file:///a.jpg", width: 1800, height: 3200, mimeType: "image/jpeg" });

    expect(resizeMock).toHaveBeenCalledWith({ height: 1600 });
  });

  it("長辺が1600px以下なら resize を呼ばない（アップスケールしない）", async () => {
    await compressImage({ uri: "file:///a.jpg", width: 800, height: 600, mimeType: "image/jpeg" });

    expect(resizeMock).not.toHaveBeenCalled();
  });

  it("JPEG品質0.8・SaveFormat.JPEG で保存する", async () => {
    await compressImage({ uri: "file:///a.jpg", width: 800, height: 600, mimeType: "image/jpeg" });

    expect(saveAsyncMock).toHaveBeenCalledWith({ compress: 0.8, format: "jpeg" });
  });

  it("圧縮結果の uri/width/height を返す", async () => {
    const result = await compressImage({ uri: "file:///a.jpg", width: 800, height: 600 });
    expect(result).toEqual({ uri: "file:///compressed.jpg", width: 1600, height: 900 });
  });

  it("対応していない形式（gif等）は UnsupportedImageTypeError を投げ、圧縮処理を呼ばない", async () => {
    await expect(
      compressImage({ uri: "file:///a.gif", width: 100, height: 100, mimeType: "image/gif" }),
    ).rejects.toBeInstanceOf(UnsupportedImageTypeError);

    expect(manipulateMock).not.toHaveBeenCalled();
  });

  it("mimeType が取得できない場合は形式チェックをスキップする", async () => {
    await expect(
      compressImage({ uri: "file:///a.jpg", width: 800, height: 600 }),
    ).resolves.not.toThrow();
  });
});

describe("uploadCompressedImage", () => {
  const compressed = { uri: "file:///compressed.jpg", width: 1600, height: 900 };

  it("post.uploadUrl から受け取った署名付きURLへ直接 PUT する", async () => {
    const requestUploadUrl = vi.fn().mockResolvedValue({ imageId: "img-1", url: "https://r2.example.com/signed" });
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input === "file:///compressed.jpg") {
        return Promise.resolve({ blob: () => Promise.resolve(new Blob(["dummy"])) });
      }
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadCompressedImage(requestUploadUrl, compressed);

    expect(requestUploadUrl).toHaveBeenCalledWith("image/jpeg");
    // アップロード先URLはサーバが発行した絶対URLをそのまま使い、クライアントは
    // 自前でURLを組み立てない（callbackURLの相対パス問題と同じ形。003で実際に発生）
    expect(fetchMock).toHaveBeenCalledWith(
      "https://r2.example.com/signed",
      expect.objectContaining({ method: "PUT", headers: { "content-type": "image/jpeg" } }),
    );
    expect(result).toEqual({ imageId: "img-1", imageWidth: 1600, imageHeight: 900 });

    vi.unstubAllGlobals();
  });

  it("PUT が失敗したらエラーを投げる", async () => {
    const requestUploadUrl = vi.fn().mockResolvedValue({ imageId: "img-1", url: "https://r2.example.com/signed" });
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input === "file:///compressed.jpg") {
        return Promise.resolve({ blob: () => Promise.resolve(new Blob(["dummy"])) });
      }
      return Promise.resolve({ ok: false });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadCompressedImage(requestUploadUrl, compressed)).rejects.toThrow();

    vi.unstubAllGlobals();
  });
});

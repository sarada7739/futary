import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

// architecture.md 6節: クライアント側で長辺 1600px / JPEG 品質 0.8 に圧縮してから送る
const MAX_LONG_SIDE = 1600;
const JPEG_QUALITY = 0.8;

// 圧縮対象として受け付ける元画像の形式。ここに無い形式（gif/heic等）は
// 圧縮結果の予測がつかないため、アップロード前にはっきり弾く
const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

export class UnsupportedImageTypeError extends Error {
  constructor(mimeType: string) {
    super(`対応していない画像形式です: ${mimeType}`);
    this.name = "UnsupportedImageTypeError";
  }
}

export interface SourceImage {
  uri: string;
  width: number;
  height: number;
  // 取得できない環境がある（プラットフォーム依存）ため任意
  mimeType?: string;
}

export interface CompressedImage {
  uri: string;
  width: number;
  height: number;
}

// 長辺が上限を超えている場合だけ resize する。既に小さい画像を無駄に
// 引き伸ばさない（アップスケールしない）
function resizeArgFor(source: SourceImage): { width?: number; height?: number } | null {
  const longSide = Math.max(source.width, source.height);
  if (longSide <= MAX_LONG_SIDE) return null;
  const isPortrait = source.height >= source.width;
  return isPortrait ? { height: MAX_LONG_SIDE } : { width: MAX_LONG_SIDE };
}

export async function compressImage(source: SourceImage): Promise<CompressedImage> {
  if (source.mimeType && !SUPPORTED_MIME_TYPES.has(source.mimeType)) {
    throw new UnsupportedImageTypeError(source.mimeType);
  }

  let context = ImageManipulator.manipulate(source.uri);
  const resizeArg = resizeArgFor(source);
  if (resizeArg) context = context.resize(resizeArg);

  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });

  return { uri: result.uri, width: result.width, height: result.height };
}

export interface UploadedImage {
  imageId: string;
  imageWidth: number;
  imageHeight: number;
}

// post.uploadUrl が発行した署名付きURLへ直接 PUT する。画像本体は Worker を
// 経由しない（architecture.md 6節）。requestUploadUrl を引数で受け取るのは、
// orpc クライアントへの直接依存を避けてテストしやすくするため
export async function uploadCompressedImage(
  requestUploadUrl: (contentType: "image/jpeg") => Promise<{ imageId: string; url: string }>,
  compressed: CompressedImage,
): Promise<UploadedImage> {
  const { imageId, url } = await requestUploadUrl("image/jpeg");

  const blob = await (await fetch(compressed.uri)).blob();
  const putResponse = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body: blob,
  });
  if (!putResponse.ok) {
    throw new Error("画像のアップロードに失敗しました");
  }

  return { imageId, imageWidth: compressed.width, imageHeight: compressed.height };
}

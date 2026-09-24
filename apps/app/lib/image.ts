import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

// クライアントで長辺 1600px・JPEG 品質 0.8 に圧縮してから送る（architecture.md 6節）
const MAX_LONG_SIDE = 1600;
const JPEG_QUALITY = 0.8;

// 圧縮して受け付ける元の形式。無い形式（gif・heic 等）は結果の予測がつかないので、アップロード前に弾く
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
  // 取れない環境がある（プラットフォーム依存）ので任意
  mimeType?: string;
}

export interface CompressedImage {
  uri: string;
  width: number;
  height: number;
}

// 長辺が上限を超えるときだけ縮める（小さい画像を引き伸ばさない）
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

// 署名付き URL へ直接 PUT する（本体は Worker を通らない。architecture.md 6節）。
// requestUploadUrl を引数で受けるのは、orpc クライアントに直接依存せずテストしやすくするため
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

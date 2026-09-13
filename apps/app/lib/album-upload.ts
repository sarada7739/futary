import * as ImagePicker from "expo-image-picker";
import { compressImage, uploadCompressedImage, type SourceImage, type UploadedImage } from "./image";

// 041: アルバムの写真の選択とアップロード。compose.tsx の pickImages（複数選択・上限つき）と
// 同じ経路を、投稿の 4 枚とは別の上限（1 回 20 枚）で使うために切り出した。
// compose 自体の挙動は変えていない（停止条件「投稿の 4 枚の見え方を変えない」）

export async function pickAlbumImages(limit: number): Promise<SourceImage[]> {
  if (limit <= 0) return [];
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
  });
  if (result.canceled) return [];

  return result.assets
    .slice(0, limit)
    .map((asset) => ({ uri: asset.uri, width: asset.width, height: asset.height, mimeType: asset.mimeType }));
}

export type UploadProgress = { done: number; total: number };

// 1 枚ずつ圧縮して署名付き PUT で送る。並行にしないのは (1) 進捗を「3 / 12 枚」で出すため、
// (2) album.uploadUrl が発行する imageId（ULID）が選んだ順に並び、同秒の taken_at でも
// アルバム内の並びが選択順になるため。1 枚でも失敗したら例外を投げる（呼び出し側は
// album.addPhotos を呼ばない。T15。サーバ側も全部の実体を確かめてから書く）
export async function uploadAlbumImages(
  sources: readonly SourceImage[],
  requestUploadUrl: (contentType: "image/jpeg") => Promise<{ imageId: string; url: string }>,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadedImage[]> {
  const uploaded: UploadedImage[] = [];
  onProgress?.({ done: 0, total: sources.length });
  for (const source of sources) {
    const compressed = await compressImage(source);
    uploaded.push(await uploadCompressedImage(requestUploadUrl, compressed));
    onProgress?.({ done: uploaded.length, total: sources.length });
  }
  return uploaded;
}

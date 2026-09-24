import * as ImagePicker from "expo-image-picker";
import { MAX_PHOTOS_PER_ADD } from "@futary/contract";
import { chunk } from "./chunk";
import { compressImage, uploadCompressedImage, type SourceImage, type UploadedImage } from "./image";

// アルバムの写真の選択とアップロード（041）。compose.tsx の pickImages と同じ経路を、投稿の 4 枚とは別の上限で使う

// 詳細の + で一度に選べる枚数（ZIP の 1 ファイル分）。album.addPhotos は 1〜20 のままなので、
// MAX_PHOTOS_PER_ADD 枚ずつに割って順に呼ぶ（049）
export const ALBUM_UPLOAD_BATCH_MAX = 100;

// OS の選択画面は selectionLimit で止まるが、Web の <input multiple> には上限が無いので超えた分も返す
// （呼び出し側が「一度に入れられるのは N 枚までです」で止める）
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

  return result.assets.map((asset) => ({ uri: asset.uri, width: asset.width, height: asset.height, mimeType: asset.mimeType }));
}

export type UploadProgress = { done: number; total: number };

// 1 枚ずつ圧縮して署名付き PUT で送る。並行にしないのは、進捗を「3 / 12 枚」で出すためと、imageId（ULID）が
// 選んだ順に並んで同じ秒でも選択順になるため。1 枚でも失敗したら投げる（呼び出し側は addPhotos を呼ばない）
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

export type BatchUploadOptions = {
  onProgress?: (progress: UploadProgress) => void;
  // 途中で閉じる。次の 1 枚に進む前に見る（送り終えた塊は残る）
  signal?: AbortSignal;
  // 残りの塊を続けずに投げ直す失敗（PLAN_LIMIT: 画面がシートを出す）
  stopOn?: (error: unknown) => boolean;
};

export type BatchUploadResult = {
  // album.addPhotos で入った枚数
  added: number;
  // 入らなかった枚数（塊の中で 1 枚でも失敗したらその塊の全部。addPhotos が失敗した塊も）
  failed: number;
  // 途中で閉じた（signal）。added はそれまでに入った枚数
  aborted: boolean;
};

// 選んだ写真を MAX_PHOTOS_PER_ADD 枚ずつの塊にし、塊ごとに「1 枚ずつ圧縮 → PUT → addPhotos」。
// 塊の中で 1 枚でも失敗したらその塊は addPhotos を呼ばず（実体が揃わない）、残りの塊は続ける。
// 進捗は PUT が済んだ枚数の通し（「37 / 100 枚を送っています…」）。圧縮は直列（iPhone のメモリ）
export async function uploadAlbumImagesInBatches(
  sources: readonly SourceImage[],
  requestUploadUrl: (contentType: "image/jpeg") => Promise<{ imageId: string; url: string }>,
  addPhotos: (uploaded: UploadedImage[]) => Promise<unknown>,
  options: BatchUploadOptions = {},
): Promise<BatchUploadResult> {
  const { onProgress, signal, stopOn } = options;
  const total = sources.length;
  let done = 0;
  let added = 0;
  let failed = 0;
  onProgress?.({ done, total });
  for (const batch of chunk(sources, MAX_PHOTOS_PER_ADD)) {
    if (signal?.aborted) return { added, failed, aborted: true };
    const uploaded: UploadedImage[] = [];
    let batchFailed = false;
    for (const source of batch) {
      if (signal?.aborted) return { added, failed, aborted: true };
      try {
        const compressed = await compressImage(source);
        uploaded.push(await uploadCompressedImage(requestUploadUrl, compressed));
      } catch {
        // この塊は入れない。残りの枚は送らない（送っても addPhotos を呼ばないので無駄になる）
        batchFailed = true;
        break;
      }
      done += 1;
      onProgress?.({ done, total });
    }
    if (batchFailed) {
      failed += batch.length;
      done += batch.length - uploaded.length;
      onProgress?.({ done, total });
      continue;
    }
    // 塊の PUT が全部済んでいれば、閉じられていても addPhotos は呼ぶ（送った実体を無駄にしない）
    try {
      await addPhotos(uploaded);
      added += uploaded.length;
    } catch (error) {
      if (stopOn?.(error)) throw error;
      failed += batch.length;
    }
  }
  return { added, failed, aborted: false };
}

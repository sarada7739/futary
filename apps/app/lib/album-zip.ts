import { strToU8, zipSync } from "fflate";
import type { PhotoRef } from "@futary/contract";
import { PHOTO_LIST_MAX_LIMIT } from "@futary/contract";
import { formatJstDateCompact } from "@futary/date";
import { chunk } from "./chunk";
import { client } from "./orpc";
import { saveFromUrl } from "./photo-download";

// 048 段階1: アルバムの写真を ZIP で持ち出す。ブラウザで組む（`fetch` → `zipSync`、無圧縮）。
// Worker は通さない（無料枠の CPU 10ms で CRC32 を全バイトに掛けられない。architecture.md）。
// 写真ライブラリに入れるのは 042 の共有シート。ZIP は「持ち出し」だけ（iPhone では「ファイル」に落ちる。それでよい）

// 1 つの ZIP に入れる枚数の上限。超えるアルバムは 100 枚ずつ複数の ZIP（`-1of3`）。
// iPhone の Safari で 100 枚（30〜60MB）が落ちないかは人間の iPhone で。落ちるなら 50（タスク定義 2節）
export const ZIP_PART_SIZE = 100;
// 確認の「約 15MB」の概算に使う 1 枚あたりの大きさ（1600px の JPEG は 300〜600KB。タスク定義 2節「枚数 × 400KB」）
export const ESTIMATED_BYTES_PER_PHOTO = 400 * 1024;
// 説明文を 1 行 1 枚で同梱するファイル
export const CAPTIONS_FILENAME = "captions.txt";

// 何を持ち出すか。album: 1 つのアルバム / all: 作ったアルバム全部（タイムラインは含めない）
export type ZipSource = { kind: "album"; albumId: string; title: string } | { kind: "all" };

export type ZipPhoto = {
  ref: PhotoRef;
  caption: string;
  // 全部のときはアルバムごとのフォルダに分ける（アルバム名を安全な文字にしたもの）。1 つのときは null（直下）
  folder: string | null;
};

export type ZipProgress = { done: number; total: number };

export type ZipResult = {
  // saved: 1 つ以上の ZIP を保存した / aborted: 途中で閉じた / nothing: 1 枚も取得できず ZIP を作っていない
  outcome: "saved" | "aborted" | "nothing";
  // 取得できなかった枚数（飛ばして続け、最後に「N 枚は保存できませんでした」）
  failed: number;
  // 保存した ZIP の数
  parts: number;
};

// ZIP とフォルダの名前に使えない文字（`/ \ : * ? " < > |` と制御文字・TAB・改行）を `_` に（タスク定義 2節）。
// `.` だけの名前（`.` `..`）は "album" に倒す（全部のときのフォルダ名になるので `../` のパスを ZIP に入れない。
// captions.txt の区切り（TAB）も壊さない）。空になったら "album"
// eslint-disable-next-line no-control-regex -- 制御文字を名前から落とすのが目的
const UNSAFE_NAME_CHARS = /[/\\:*?"<>|\x00-\x1f\x7f]/g;
export function safeZipName(name: string): string {
  const safe = name.replace(UNSAFE_NAME_CHARS, "_").trim();
  return safe === "" || /^\.+$/.test(safe) ? "album" : safe;
}

export function zipBaseName(source: ZipSource): string {
  return source.kind === "album" ? safeZipName(source.title) : "albums";
}

// `nisoine-{base}-{YYYYMMDD}.zip`。分けるときは `nisoine-{base}-{YYYYMMDD}-1of3.zip`（051 で futary- から）
export function zipFileName(base: string, ymd: string, part: { index: number; total: number } | null): string {
  const suffix = part ? `-${part.index}of${part.total}` : "";
  return `nisoine-${base}-${ymd}${suffix}.zip`;
}

export function zipPartCount(photoCount: number): number {
  return Math.ceil(photoCount / ZIP_PART_SIZE);
}

// 「38 枚を ZIP で保存します（約 15MB）」。1MB 未満は「約 1MB」
export function zipConfirmLabel(photoCount: number): string {
  const mb = Math.max(1, Math.round((photoCount * ESTIMATED_BYTES_PER_PHOTO) / (1024 * 1024)));
  return `${photoCount} 枚を ZIP で保存します（約 ${mb}MB）`;
}

export function zipPartsLabel(parts: number): string {
  return `${parts} つのファイルに分けて保存します`;
}

// captions.txt の中身。1 行 1 枚「{ZIP 内のパス}<TAB>{説明文}」。説明文の改行・TAB は空白にする（1 行・区切り 1 つに保つ）
export function captionsText(entries: readonly { name: string; caption: string }[]): string {
  return entries.map((e) => `${e.name}\t${e.caption.replace(/\r?\n|\t/g, " ")}`).join("\n") + "\n";
}

// 1 つのアルバムの写真を全部集める（photo.list を limit 60 で最後まで。ゲストも呼べる）
async function collectAlbum(albumId: string, folder: string | null): Promise<ZipPhoto[]> {
  const photos: ZipPhoto[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.photo.list({ albumId, cursor, limit: PHOTO_LIST_MAX_LIMIT });
    for (const photo of page.items) photos.push({ ref: photo.ref, caption: photo.caption, folder });
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return photos;
}

// 持ち出す写真の一覧（表示順）。全部のときは album.list の items だけを辿る
// （タイムラインは投稿の写真で、albumId 無しの photo.list は呼ばない。タスク定義 5節）
export async function collectZipPhotos(source: ZipSource): Promise<ZipPhoto[]> {
  if (source.kind === "album") return collectAlbum(source.albumId, null);
  const { items } = await client.album.list({});
  const photos: ZipPhoto[] = [];
  for (const album of items) {
    if (album.photoCount === 0) continue;
    photos.push(...(await collectAlbum(album.id, safeZipName(album.title))));
  }
  return photos;
}

// 組んだ ZIP を `<a download>` で保存する（Blob URL。同一オリジンなので download 属性の名前が効く）。
// URL は少し置いてから捨てる（クリックの直後に捨てるとブラウザによっては保存が始まらない）
const REVOKE_DELAY_MS = 10_000;
export function saveZipFile(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  saveFromUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export type ExportZipOptions = {
  signal: AbortSignal;
  onProgress?: (progress: ZipProgress) => void;
  // テストで差し替える（jsdom には URL.createObjectURL が無い）
  save?: (bytes: Uint8Array, filename: string) => void;
  nowMs?: number;
};

function abortError(): Error {
  return new DOMException("ZIP の作成を中止しました", "AbortError");
}

// 写真を順に photo.downloadUrl → fetch し、100 枚ずつ ZIP に組んで 1 つずつ保存する。
// photo.downloadUrl は枚数ぶん呼ぶ（1 リクエスト 1 署名。042 と同じ）。
// 取れなかった枚は飛ばして続ける。途中で閉じたら（signal）その場で止めて aborted（それまでに保存した ZIP は残る）
export async function exportZip(photos: readonly ZipPhoto[], base: string, options: ExportZipOptions): Promise<ZipResult> {
  const { signal, onProgress, save = saveZipFile } = options;
  const ymd = formatJstDateCompact(Math.floor((options.nowMs ?? Date.now()) / 1000));
  const parts = chunk(photos, ZIP_PART_SIZE);
  const total = photos.length;
  let done = 0;
  let failed = 0;
  let saved = 0;
  onProgress?.({ done, total });
  try {
    for (const [partIndex, part] of parts.entries()) {
      const files: Record<string, Uint8Array> = {};
      const captions: { name: string; caption: string }[] = [];
      for (const photo of part) {
        if (signal.aborted) throw abortError();
        try {
          const { url, filename } = await client.photo.downloadUrl(photo.ref);
          if (signal.aborted) throw abortError();
          const response = await fetch(url, { signal });
          if (!response.ok) throw new Error("画像の取得に失敗しました");
          const name = photo.folder === null ? filename : `${photo.folder}/${filename}`;
          files[name] = new Uint8Array(await response.arrayBuffer());
          captions.push({ name, caption: photo.caption });
        } catch (error) {
          if (signal.aborted) throw error;
          failed += 1;
        }
        done += 1;
        onProgress?.({ done, total });
      }
      if (captions.length === 0) continue;
      // strToU8（TextEncoder）の Uint8Array は実行環境（realm）が違うと zipSync が「入れ子のフォルダ」と
      // 読み違える（jsdom で実測。photo-download.ts の File と同じ形）。同じ realm の Uint8Array に包み直す
      files[CAPTIONS_FILENAME] = new Uint8Array(strToU8(captionsText(captions)));
      // 無圧縮（JPEG は縮まない。CRC32 だけ掛かる）
      const bytes = zipSync(files, { level: 0 });
      save(bytes, zipFileName(base, ymd, parts.length > 1 ? { index: partIndex + 1, total: parts.length } : null));
      saved += 1;
    }
  } catch (error) {
    if (signal.aborted) return { outcome: "aborted", failed, parts: saved };
    throw error;
  }
  return { outcome: saved === 0 ? "nothing" : "saved", failed, parts: saved };
}

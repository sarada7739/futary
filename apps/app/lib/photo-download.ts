import { Linking, Platform } from "react-native";
import type { PhotoRef } from "@futary/contract";
import { client } from "./orpc";

// サーバが返す保存用の署名付き URL（attachment 付き。5 分）を `<a href download>` で開く（新しいタブは開かない。
// Linking.openURL だと空のタブが残る）。download 属性はクロスオリジンでは無視されるが、R2 の
// Content-Disposition: attachment が保存させる（artifacts/041/download.md）
export function saveFromUrl(url: string, filename: string): void {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }
  // ネイティブはまだ出さない（Web だけ）。届いたときのために URL を開く経路だけ残す
  void Linking.openURL(url);
}

const JPEG_MIME = "image/jpeg";

// iPhone・Android のブラウザは Web Share API に File を渡せ、共有シートの「画像を保存」で写真ライブラリに
// 入る（iOS Safari の <a download> は「ダウンロード」に落ちて遠い）。canShare({ files }) で判定し、PC は <a download>
export function canShareFiles(): boolean {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void> };
  if (typeof nav.canShare !== "function" || typeof nav.share !== "function") return false;
  try {
    // 判定用のダミーの File（canShare は型と形だけを見る）
    return nav.canShare({ files: [new File([], "probe.jpg", { type: JPEG_MIME })] });
  } catch {
    return false;
  }
}

// 署名付き URL を fetch → File。fetch は <img> と違って CORS が要る（本番 R2 の CORS にアプリのオリジンと GET がある）
export async function fetchPhotoFile(url: string, filename: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("画像の取得に失敗しました");
  // Blob でなく ArrayBuffer を渡す（realm が違うと File が中身でなく文字列 "[object Blob]" を包む。
  // CI の Node 22 + jsdom で起きた）
  const bytes = await response.arrayBuffer();
  return new File([bytes], filename, { type: JPEG_MIME });
}

// 共有シートに File を渡す。閉じた（AbortError）ら "aborted"。他の失敗は投げる（呼び出し側が <a download> に倒す）
export type ShareOutcome = "shared" | "aborted";

export async function shareFiles(files: File[]): Promise<ShareOutcome> {
  try {
    await navigator.share({ files });
    return "shared";
  } catch (error) {
    // DOMException は環境によって Error を継承しない（jsdom）ので name だけで見る
    if (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError") {
      return "aborted";
    }
    throw error;
  }
}

// ビューアの保存ボタンが呼ぶ。photo.downloadUrl → 共有シート（できる環境）か <a download>。
// 共有の経路で fetch や share が失敗したら（AbortError を除く）<a download> に倒す
export async function downloadPhoto(ref: PhotoRef): Promise<void> {
  const { url, filename } = await client.photo.downloadUrl(ref);
  if (canShareFiles()) {
    try {
      const file = await fetchPhotoFile(url, filename);
      await shareFiles([file]);
      return;
    } catch {
      // 取れない・共有シートが出せない（NotAllowedError 等）→ <a download> に倒す
    }
  }
  saveFromUrl(url, filename);
}

// 選んだ写真をまとめて写真ライブラリへ（同じ共有シートに複数の File。042）。1 回 MAX_SHARE_FILES 枚まで
// （1600px の JPEG は 1 枚 300〜600KB で、渡す File はブラウザのメモリに乗る）
export const MAX_SHARE_FILES = 20;

export type ShareProgress = { done: number; total: number };

export type SharePhotosResult = {
  // shared: 保存した / aborted: 閉じた / nothing: 1 枚も取れず共有シートを出していない
  outcome: ShareOutcome | "nothing";
  // 取れなかった枚数（飛ばして残りで共有シートを出す。全部やり直しにしない）
  failed: number;
};

// ref を順に photo.downloadUrl → fetch → File にし、揃った分を 1 回の navigator.share に渡す
// （専用の手続きを足さず、1 枚ずつ署名する）。失敗した枚は飛ばす。AbortError は "aborted"、他は投げる。
// MAX_SHARE_FILES 超は例外（画面が「保存」を無効にして守るが、外れても lib で止める）
export async function sharePhotos(
  refs: readonly PhotoRef[],
  onProgress?: (progress: ShareProgress) => void,
): Promise<SharePhotosResult> {
  if (refs.length > MAX_SHARE_FILES) throw new Error(`一度に保存できるのは ${MAX_SHARE_FILES} 枚までです`);
  const files: File[] = [];
  let failed = 0;
  onProgress?.({ done: 0, total: refs.length });
  for (const ref of refs) {
    try {
      const { url, filename } = await client.photo.downloadUrl(ref);
      files.push(await fetchPhotoFile(url, filename));
    } catch {
      failed += 1;
    }
    onProgress?.({ done: files.length + failed, total: refs.length });
  }
  if (files.length === 0) return { outcome: "nothing", failed };
  const outcome = await shareFiles(files);
  return { outcome, failed };
}

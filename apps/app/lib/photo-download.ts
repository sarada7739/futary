import { Linking, Platform } from "react-native";
import type { PhotoRef } from "@futary/contract";
import { client } from "./orpc";

// 041 タスク定義4節 (a): サーバが返す保存用の署名付き URL（Content-Disposition: attachment 付き。
// 5 分）を `<a href download>` で開く。新しいタブを開かない（Linking.openURL は空のタブが残る）。
// download 属性はクロスオリジンの URL では無視されるが、R2 が返す Content-Disposition: attachment
// がブラウザに保存させる（artifacts/041/download.md で実測）。filename はサーバが組み立てたもので、
// ここでは表示名として同じ値を付けるだけ
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
  // ネイティブは 033 と同じく今回は出さない（Web だけ）。届いたときのために URL を開く経路だけ残す
  void Linking.openURL(url);
}

const JPEG_MIME = "image/jpeg";

// 041 段階2（8節）: iPhone・Android のブラウザは Web Share API に File を渡せる。共有シートの
// 「画像を保存」で 1 タップで写真ライブラリに入る（段階1の <a download> は iOS Safari では
// 「ダウンロード」に落ち、写真ライブラリまで遠い。人間の実機の要望）。
// canShare({ files }) で判定する。PC は偽になり、今までどおり <a download>
export function canShareFiles(): boolean {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void> };
  if (typeof nav.canShare !== "function" || typeof nav.share !== "function") return false;
  try {
    // 判定用のダミーの File。中身は見られない（canShare は型と形だけを見る）
    return nav.canShare({ files: [new File([], "probe.jpg", { type: JPEG_MIME })] });
  } catch {
    return false;
  }
}

// 署名付き URL を fetch → File（filename・image/jpeg）。fetch は <img> と違って CORS が要る
// （本番 R2 の CORS にアプリのオリジンと GET がある。人間が r2:cors:list で確認済み）
export async function fetchPhotoFile(url: string, filename: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("画像の取得に失敗しました");
  // Blob ではなく ArrayBuffer を渡す。Blob は実行環境（realm）が違うと File が中身ではなく
  // 文字列 "[object Blob]" を包んでしまう（CI の Node 22 + jsdom で実測。ブラウザでは起きないが、
  // ArrayBuffer はどの環境でも同じに扱われる）
  const bytes = await response.arrayBuffer();
  return new File([bytes], filename, { type: JPEG_MIME });
}

// 共有シートに File を渡す。利用者が閉じた（AbortError）ときは "aborted" を返して何もしない。
// それ以外の失敗は例外のまま投げる（呼び出し側が <a download> に倒す）
export type ShareOutcome = "shared" | "aborted";

export async function shareFiles(files: File[]): Promise<ShareOutcome> {
  try {
    await navigator.share({ files });
    return "shared";
  } catch (error) {
    // DOMException は環境によって Error を継承しない（jsdom で実測）。name だけで判定する
    if (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError") {
      return "aborted";
    }
    throw error;
  }
}

// ビューアの保存ボタンが呼ぶ 1 本。photo.downloadUrl → 共有シート（できる環境）か <a download>。
// 共有の経路で fetch や share が失敗したら（AbortError を除く）<a download> に倒す（8節）。
// 段階0（人間の iPhone）: await fetch のあとの share が NotAllowedError にならないか。駄目なら
// 表示中の 1 枚を先読みして押下で share だけ呼ぶ形に変える
export async function downloadPhoto(ref: PhotoRef): Promise<void> {
  const { url, filename } = await client.photo.downloadUrl(ref);
  if (canShareFiles()) {
    try {
      const file = await fetchPhotoFile(url, filename);
      await shareFiles([file]);
      return;
    } catch {
      // 取得できない・共有シートが出せない（NotAllowedError 等）→ 段階1の経路に倒す
    }
  }
  saveFromUrl(url, filename);
}

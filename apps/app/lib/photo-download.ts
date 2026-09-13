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

// ビューアの保存ボタンが呼ぶ 1 本。photo.downloadUrl → 保存
export async function downloadPhoto(ref: PhotoRef): Promise<void> {
  const { url, filename } = await client.photo.downloadUrl(ref);
  saveFromUrl(url, filename);
}

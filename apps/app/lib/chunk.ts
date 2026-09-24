// 配列を size ずつに分ける（選択モードの削除で、album.removePhotos の上限 100 を超える選択を分けて送る）
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("size は 1 以上");
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

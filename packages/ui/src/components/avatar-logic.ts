/** 表示名から頭文字を1文字取り出す。空文字・空白のみの場合は "?" */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "?";
  }
  return [...trimmed][0]!.toUpperCase();
}

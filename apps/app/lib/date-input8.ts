import { isValidDate } from "@futary/date";

// 022 B: 数字8桁を YYYY-MM-DD に変換する。レイアウトに依存しない部分だけを
// ここに切り出す（conventions.md 6節）。

export function toDigits(text: string): string {
  return text.replace(/\D/g, "").slice(0, 8);
}

// 8桁揃うまではハイフンを入れない。「2024011」を「2024-01-1」にしない
// （022。区切りが入るのは8桁そろった瞬間だけ）
export function digitsToDisplay(digits: string): string {
  if (digits.length < 8) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

// 8桁に満たない、または存在しない日付（20240230等）なら空文字列を返す
export function digitsToDate(digits: string): string {
  if (digits.length !== 8) return "";
  const candidate = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return isValidDate(candidate) ? candidate : "";
}

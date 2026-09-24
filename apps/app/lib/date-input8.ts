import { isValidDate } from "@futary/date";

// 数字 8 桁を YYYY-MM-DD にする。レイアウトに依存しない部分だけを切り出す（conventions.md 6節）

export function toDigits(text: string): string {
  return text.replace(/\D/g, "").slice(0, 8);
}

// 8 桁揃うまではハイフンを入れない（「2024011」を「2024-01-1」にしない）
export function digitsToDisplay(digits: string): string {
  if (digits.length < 8) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

// 8 桁に満たない・存在しない日付（20240230 等）なら空文字列
export function digitsToDate(digits: string): string {
  if (digits.length !== 8) return "";
  const candidate = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return isValidDate(candidate) ? candidate : "";
}

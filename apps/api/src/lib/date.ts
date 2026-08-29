// JST（Asia/Tokyo）固定の日付ユーティリティ（architecture.md 4節）。
// 「タイムゾーンは Asia/Tokyo 固定。サーバ側で JST の『今日』を算出する」。
// 日付計算はここに集約する。他所で `new Date()` を直接使わない。
// Asia/Tokyo は夏時間を持たないため、UTC+9固定のオフセットで正しい。
// 実行時刻に依存する関数は `nowMs` を引数で受け取れるようにし、テストで
// 日跨ぎの境界時刻（UTC 15:00 = JST 翌日 00:00）を直接指定できるようにする

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

function parseDate(date: string): DateParts {
  const parts = date.split("-");
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

function formatDate({ year, month, day }: DateParts): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// YYYY-MM-DD をタイムゾーンに依存しない「暦日」のエポックミリ秒に変換する
// （UTC 起点で固定して扱うだけで、JST への変換はここでは行わない。
// 日付文字列同士の差分計算にのみ使う内部表現）
function toEpochDay(date: string): number {
  const { year, month, day } = parseDate(date);
  return Date.UTC(year, month - 1, day);
}

// 「今日（JST）」を YYYY-MM-DD で返す
export function todayJst(nowMs: number = Date.now()): string {
  const shifted = new Date(nowMs + JST_OFFSET_MS);
  return formatDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

// to - from を日数で返す（to が from より前なら負になる）
export function diffDays(from: string, to: string): number {
  return Math.round((toEpochDay(to) - toEpochDay(from)) / DAY_MS);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// date から n ヶ月前の日付文字列を返す（n が負なら n ヶ月後になる）。
// 日が繰り上がる場合（例: 1/31 の1ヶ月前）は JS の Date が UTC 月末を
// 自動で繰り上げる挙動にそのまま従う
export function monthsBefore(date: string, n: number): string {
  const { year, month, day } = parseDate(date);
  const shifted = new Date(Date.UTC(year, month - 1 - n, day));
  return formatDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

// date から n 年前の日付文字列を返す
export function yearsBefore(date: string, n: number): string {
  return monthsBefore(date, n * 12);
}

// date（YYYY-MM-DD）の月・日部分だけを取り出す
export function monthDayOf(date: string): { month: number; day: number } {
  const { month, day } = parseDate(date);
  return { month, day };
}

// from の年から to の年までを昇順で返す（両端含む）。
// 「射影する年を決め打ちにしない」ための唯一の窓口（architecture.md 5節）
export function yearsBetween(from: string, to: string): number[] {
  const fromYear = parseDate(from).year;
  const toYear = parseDate(to).year;
  const years: number[] = [];
  for (let year = fromYear; year <= toYear; year++) years.push(year);
  return years;
}

// month/day をある年に射影した日付文字列を返す。
// 平年の 02-29 は 02-28 に寄せる（03-01 にはしない）。
// 理由は2つ（architecture.md 5節）:
//   1. 2024-02-29 + 365日 = 2025-02-28（平年の365日後がちょうどそこに当たる）
//   2. カレンダーは月単位。03-01 に寄せると2月の記念日が平年の2月の表示から消える
// 保存されている date 自体は呼び出し側で変更しない。ここでは射影結果だけを返す
export function projectMonthDay(month: number, day: number, year: number): string {
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    return formatDate({ year, month: 2, day: 28 });
  }
  return formatDate({ year, month, day });
}

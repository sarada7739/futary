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

// 1-indexed の month（1〜12。年をまたいだ範囲でも可）が持つ日数。
// Date.UTC の「day 0 = 前月末日」という挙動を利用する（1-indexed の
// month をそのまま zero-indexed 引数に渡すと、その1つ前の月＝求めたい月の
// 末日になる）
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// month（1-indexed。1〜12の範囲外でもよい）を年の繰り上がり・繰り下がりを
// 考慮して正規化する
function normalizeYearMonth(year: number, month: number): { year: number; month: number } {
  const totalMonths = year * 12 + (month - 1);
  const normalizedYear = Math.floor(totalMonths / 12);
  const normalizedMonth = totalMonths - normalizedYear * 12 + 1;
  return { year: normalizedYear, month: normalizedMonth };
}

// date から n ヶ月前の日付文字列を返す（n が負なら n ヶ月後になる）。
// 日が月末を超える場合（例: 3/31 の1ヶ月前 → 2月に31日は無い）は、
// 「存在しない日付は、その月の末日に寄せる」という一般則
// （architecture.md 5節）に従う。素の Date の自動繰り上げ（3/31 の
// 1ヶ月前が3/3になる）には任せない
export function monthsBefore(date: string, n: number): string {
  const { year, month, day } = parseDate(date);
  const target = normalizeYearMonth(year, month - n);
  return projectMonthDay(target.month, day, target.year);
}

// date から n 年前の日付文字列を返す。年だけを引く操作は
// 「nヶ月前」の特殊形（n*12ヶ月前）として同じ規則に乗せる。
// 個別に実装すると、うるう日を平年へ寄せる規則が2箇所に分かれて
// 食い違う経路が生まれる（R レビュー指摘で実際に発生した）
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
// 「存在しない日付は、その月の末日に寄せる」（architecture.md 5節）。
// 平年の 02-29 は 02-28 に寄せる（03-01 にはしない）のはこの一般則の一例。
// 理由は2つ:
//   1. 2024-02-29 + 365日 = 2025-02-28（平年の365日後がちょうどそこに当たる）
//   2. カレンダーは月単位。03-01 に寄せると2月の記念日が平年の2月の表示から消える
// 保存されている date 自体は呼び出し側で変更しない。ここでは射影結果だけを返す
export function projectMonthDay(month: number, day: number, year: number): string {
  const clampedDay = Math.min(day, daysInMonth(year, month));
  return formatDate({ year, month, day: clampedDay });
}

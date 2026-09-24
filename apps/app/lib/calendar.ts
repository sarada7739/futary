// 月グリッドの構築（表示に関わるものだけ）。日付の計算（今日・曜日・加減算）は @futary/date に置き、
// ここでは Date を作らない（architecture.md 5節）

import { addDays, daysInMonth, dayOfWeek, formatDate } from "@futary/date";

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function monthLabel(year: number, month: number): string {
  return `${year}年${month}月`;
}

// 月グリッド（日〜土）が実際に覆う範囲。event.list はこの範囲で呼ぶ
export function monthGridRange(year: number, month: number): { from: string; to: string } {
  const firstOfMonth = formatDate({ year, month, day: 1 });
  const gridStart = addDays(firstOfMonth, -dayOfWeek(firstOfMonth));

  const lastOfMonth = formatDate({ year, month, day: daysInMonth(year, month) });
  const gridEnd = addDays(lastOfMonth, 6 - dayOfWeek(lastOfMonth));

  return { from: gridStart, to: gridEnd };
}

export type GridDay = { date: string; inMonth: boolean };

// グリッドの各日を日付順に並べる（28〜42 件）。7 件ずつで折り返すと週になる
export function buildMonthGrid(year: number, month: number): GridDay[] {
  const { from, to } = monthGridRange(year, month);

  const days: GridDay[] = [];
  let cursor = from;
  while (cursor <= to) {
    // YYYY-MM-DD はゼロ埋めなので文字列の比較がそのまま日付順
    const cursorYear = Number(cursor.slice(0, 4));
    const cursorMonth = Number(cursor.slice(5, 7));
    days.push({ date: cursor, inMonth: cursorYear === year && cursorMonth === month });
    cursor = addDays(cursor, 1);
  }

  return days;
}

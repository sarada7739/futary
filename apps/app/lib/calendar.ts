// 011: 月グリッドの構築（表示に関わるものだけ。architecture.md 5節
// 「日付計算は packages/date に置く」）。日付そのものの計算（今日・曜日・
// 日数の加減算）は @futary/date に集約し、ここでは新しい Date を作らない。
// 日〜土の実測値はAのPR #84（`docs/tasks/011-calendar-ui.md`）に基づく

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

// グリッドの各日を日付順のフラット配列で返す（28〜42件。一定しない）。
// 7件ずつで折り返すと週になる
export function buildMonthGrid(year: number, month: number): GridDay[] {
  const { from, to } = monthGridRange(year, month);

  const days: GridDay[] = [];
  let cursor = from;
  while (cursor <= to) {
    // YYYY-MM-DD は零埋めのため文字列比較がそのまま日付順になる
    const cursorYear = Number(cursor.slice(0, 4));
    const cursorMonth = Number(cursor.slice(5, 7));
    days.push({ date: cursor, inMonth: cursorYear === year && cursorMonth === month });
    cursor = addDays(cursor, 1);
  }

  return days;
}

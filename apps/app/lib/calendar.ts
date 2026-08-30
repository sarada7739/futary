// 011: 月グリッドの日付計算。JST固定（architecture.md 4節）。
// event.list をグリッドの端から端まで呼ぶための範囲計算もここに置く
// （タスク定義: 月の初日〜末日で取ると前月・翌月のセルが常に空になる）。
// 日〜土の実測値はAのPR #84（`docs/tasks/011-calendar-ui.md`）に基づく

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

function parseDate(date: string): { year: number; month: number; day: number } {
  const parts = date.split("-");
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

// 「今日（JST）」を YYYY-MM-DD で返す。apps/api/src/lib/date.ts の todayJst と同じ計算
// （apps/app は apps/api に依存しないため、この分だけは重複させる）
export function todayJst(nowMs: number = Date.now()): string {
  const shifted = new Date(nowMs + JST_OFFSET_MS);
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

// 1-indexed の month が持つ日数
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// month の繰り上がり・繰り下がりを正規化する
function normalizeYearMonth(year: number, month: number): { year: number; month: number } {
  const totalMonths = year * 12 + (month - 1);
  const normalizedYear = Math.floor(totalMonths / 12);
  const normalizedMonth = totalMonths - normalizedYear * 12 + 1;
  return { year: normalizedYear, month: normalizedMonth };
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  return normalizeYearMonth(year, month + delta);
}

export function monthLabel(year: number, month: number): string {
  return `${year}年${month}月`;
}

// 月グリッド（日〜土）が実際に覆う範囲。event.list はこの範囲で呼ぶ
export function monthGridRange(year: number, month: number): { from: string; to: string } {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - firstOfMonth.getUTCDay());

  const lastDay = daysInMonth(year, month);
  const lastOfMonth = new Date(Date.UTC(year, month - 1, lastDay));
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - lastOfMonth.getUTCDay()));

  return {
    from: formatDate(gridStart.getUTCFullYear(), gridStart.getUTCMonth() + 1, gridStart.getUTCDate()),
    to: formatDate(gridEnd.getUTCFullYear(), gridEnd.getUTCMonth() + 1, gridEnd.getUTCDate()),
  };
}

export type GridDay = { date: string; inMonth: boolean };

// グリッドの各日を日付順のフラット配列で返す（28〜42件。一定しない）。
// 7件ずつで折り返すと週になる
export function buildMonthGrid(year: number, month: number): GridDay[] {
  const { from, to } = monthGridRange(year, month);
  const start = parseDate(from);

  const days: GridDay[] = [];
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const end = new Date(`${to}T00:00:00.000Z`);

  while (cursor.getTime() <= end.getTime()) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    const d = cursor.getUTCDate();
    days.push({ date: formatDate(y, m, d), inMonth: y === year && m === month });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

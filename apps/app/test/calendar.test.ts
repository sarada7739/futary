import { describe, expect, it } from "vitest";
import { addMonths, buildMonthGrid, monthGridRange, todayJst } from "../lib/calendar";

describe("todayJst", () => {
  it("UTC 15:00（JST 翌日 00:00）を跨ぐと日付が進む", () => {
    // 2026-08-30T14:59:59Z はまだ JST 2026-08-30 23:59:59
    expect(todayJst(Date.UTC(2026, 7, 30, 14, 59, 59))).toBe("2026-08-30");
    // 2026-08-30T15:00:00Z から JST 2026-08-31 00:00:00
    expect(todayJst(Date.UTC(2026, 7, 30, 15, 0, 0))).toBe("2026-08-31");
  });
});

// 011タスクファイル・AのPR #84（docs/tasks/011-calendar-ui.md）が実測した値。
// 日〜土始まりの月グリッド
describe("monthGridRange", () => {
  it("2026年12月: 年をまたいで翌年1月まで届く（35日）", () => {
    expect(monthGridRange(2026, 12)).toEqual({ from: "2026-11-29", to: "2027-01-02" });
  });

  it("2027年1月: 前年12月から始まり、6週42日になる", () => {
    expect(monthGridRange(2027, 1)).toEqual({ from: "2026-12-27", to: "2027-02-06" });
  });

  it("2026年2月: 月初が日曜のため前後に食い込まず28日ちょうど", () => {
    expect(monthGridRange(2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("2028年2月: 35日", () => {
    expect(monthGridRange(2028, 1 + 1)).toEqual({ from: "2028-01-30", to: "2028-03-04" });
  });
});

describe("buildMonthGrid", () => {
  it("日数がグリッドの範囲と一致し、月内フラグが正しい（2026年2月・28日）", () => {
    const grid = buildMonthGrid(2026, 2);
    expect(grid).toHaveLength(28);
    expect(grid[0]).toEqual({ date: "2026-02-01", inMonth: true });
    expect(grid[27]).toEqual({ date: "2026-02-28", inMonth: true });
    expect(grid.every((day) => day.inMonth)).toBe(true);
  });

  it("42日になる月では、前月・翌月のセルが inMonth: false で含まれる（2027年1月）", () => {
    const grid = buildMonthGrid(2027, 1);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ date: "2026-12-27", inMonth: false });
    expect(grid.at(-1)).toEqual({ date: "2027-02-06", inMonth: false });
    // 1月本体（31日）は全て inMonth: true
    expect(grid.filter((day) => day.inMonth)).toHaveLength(31);
  });

  it("年をまたぐ月（12月）でも1本の配列で返る", () => {
    const grid = buildMonthGrid(2026, 12);
    expect(grid).toHaveLength(35);
    expect(grid[0]!.date).toBe("2026-11-29");
    expect(grid.at(-1)!.date).toBe("2027-01-02");
  });
});

describe("addMonths", () => {
  it("年をまたいで進む", () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it("年をまたいで戻る", () => {
    expect(addMonths(2027, 1, -1)).toEqual({ year: 2026, month: 12 });
  });

  it("同一年内の移動", () => {
    expect(addMonths(2026, 6, 1)).toEqual({ year: 2026, month: 7 });
  });
});

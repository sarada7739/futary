import { describe, expect, it } from "vitest";
import {
  diffDays,
  isLeapYear,
  monthDayOf,
  monthsBefore,
  projectMonthDay,
  todayJst,
  yearsBefore,
  yearsBetween,
} from "../src/lib/date";

describe("todayJst", () => {
  // JST は UTC+9 固定（夏時間なし）。UTC 15:00 は JST 翌日 00:00 にあたる
  it("UTCの日付が変わる前でも、JSTでは既に日付が変わっていることがある", () => {
    const utcBeforeMidnightJst = Date.UTC(2026, 0, 1, 14, 59, 59, 999); // JST 2026-01-01 23:59:59.999
    const utcAtMidnightJst = Date.UTC(2026, 0, 1, 15, 0, 0, 0); // JST 2026-01-02 00:00:00.000

    expect(todayJst(utcBeforeMidnightJst)).toBe("2026-01-01");
    expect(todayJst(utcAtMidnightJst)).toBe("2026-01-02");
  });

  it("年またぎでも正しく繰り上がる", () => {
    const utcNewYearEveJst = Date.UTC(2026, 11, 31, 15, 0, 0); // JST 2027-01-01 00:00:00
    expect(todayJst(utcNewYearEveJst)).toBe("2027-01-01");
  });
});

describe("diffDays", () => {
  it("同じ日は0", () => {
    expect(diffDays("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("toがfromより後なら正の日数", () => {
    expect(diffDays("2026-01-01", "2026-01-02")).toBe(1);
  });

  it("toがfromより前なら負の日数", () => {
    expect(diffDays("2026-01-02", "2026-01-01")).toBe(-1);
  });

  it("うるう年の2月をまたぐと平年より1日多い", () => {
    expect(diffDays("2024-02-28", "2024-03-01")).toBe(2);
    expect(diffDays("2023-02-28", "2023-03-01")).toBe(1);
  });

  it("architecture.md 5節の実例: 2026-12-20〜2028-01-24 はちょうど400日", () => {
    expect(diffDays("2026-12-20", "2028-01-24")).toBe(400);
  });
});

describe("isLeapYear", () => {
  it("4で割り切れる年はうるう年", () => {
    expect(isLeapYear(2024)).toBe(true);
  });

  it("4で割り切れない年はうるう年でない", () => {
    expect(isLeapYear(2026)).toBe(false);
  });

  it("100で割り切れるが400で割り切れない年はうるう年でない", () => {
    expect(isLeapYear(1900)).toBe(false);
  });

  it("400で割り切れる年はうるう年", () => {
    expect(isLeapYear(2000)).toBe(true);
  });
});

describe("monthsBefore / yearsBefore", () => {
  it("nヶ月前の日付を返す", () => {
    expect(monthsBefore("2026-03-15", 1)).toBe("2026-02-15");
  });

  it("年をまたいでnヶ月前を計算する", () => {
    expect(monthsBefore("2026-01-15", 1)).toBe("2025-12-15");
  });

  it("n年前の日付を返す", () => {
    expect(yearsBefore("2026-03-15", 1)).toBe("2025-03-15");
  });
});

describe("monthDayOf", () => {
  it("YYYY-MM-DDから月と日を取り出す", () => {
    expect(monthDayOf("2020-02-29")).toEqual({ month: 2, day: 29 });
  });
});

describe("yearsBetween", () => {
  it("fromとtoが同じ年なら1件", () => {
    expect(yearsBetween("2026-01-01", "2026-12-31")).toEqual([2026]);
  });

  it("年をまたぐ範囲は触れる年をすべて含む", () => {
    expect(yearsBetween("2026-12-20", "2027-01-10")).toEqual([2026, 2027]);
  });

  it("architecture.md 5節の実例: 400日の窓が3つの暦年に触れる", () => {
    expect(yearsBetween("2026-12-20", "2028-01-24")).toEqual([2026, 2027, 2028]);
  });
});

describe("projectMonthDay", () => {
  it("うるう年でない02-29の月日は02-28に寄せる", () => {
    expect(projectMonthDay(2, 29, 2026)).toBe("2026-02-28");
  });

  it("うるう年への射影は02-29のまま", () => {
    expect(projectMonthDay(2, 29, 2024)).toBe("2024-02-29");
    expect(projectMonthDay(2, 29, 2028)).toBe("2028-02-29");
  });

  it("02-29以外の月日はそのまま射影する", () => {
    expect(projectMonthDay(6, 15, 2027)).toBe("2027-06-15");
  });
});

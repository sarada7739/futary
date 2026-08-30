import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  dayOfWeek,
  diffDays,
  formatJstDate,
  formatJstDateTime,
  isLeapYear,
  isValidDate,
  jstDayRangeMs,
  monthDayOf,
  monthsBefore,
  projectMonthDay,
  todayJst,
  yearsBefore,
  yearsBetween,
} from "../src/index";

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

describe("addDays", () => {
  it("正のnで先の日付を返す", () => {
    expect(addDays("2026-01-01", 1)).toBe("2026-01-02");
  });

  it("負のnで前の日付を返す", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("月末・年末をまたぐ", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("diffDaysの逆演算になる（011の月グリッド計算で使う）", () => {
    expect(addDays("2027-01-01", -diffDays("2026-12-27", "2027-01-01"))).toBe("2026-12-27");
  });
});

describe("dayOfWeek", () => {
  // 2026-02-01 は日曜（011タスクファイル・AのPR #84の実測値の前提）
  it("日曜は0", () => {
    expect(dayOfWeek("2026-02-01")).toBe(0);
  });

  it("土曜は6", () => {
    expect(dayOfWeek("2026-02-07")).toBe(6);
  });
});

describe("jstDayRangeMs", () => {
  // JST 2026-01-02 00:00〜24:00 はUTCでは 2026-01-01T15:00 〜 2026-01-02T15:00
  it("JSTの暦日はUTCで9時間前にずれた範囲になる", () => {
    expect(jstDayRangeMs("2026-01-02")).toEqual({
      fromMs: Date.UTC(2026, 0, 1, 15, 0, 0),
      toMs: Date.UTC(2026, 0, 2, 15, 0, 0),
    });
  });

  it("範囲の境界値がその日のtodayJstと一致する（013 memory.getの範囲検索で使う）", () => {
    const { fromMs, toMs } = jstDayRangeMs("2026-06-15");
    expect(todayJst(fromMs)).toBe("2026-06-15");
    expect(todayJst(toMs - 1)).toBe("2026-06-15");
    expect(todayJst(toMs)).toBe("2026-06-16");
  });
});

describe("formatJstDate / formatJstDateTime", () => {
  // L64（Rレビュー指摘）: timeZoneを明示しないtoLocaleDateString/toLocaleStringは
  // 端末のタイムゾーンで解釈され、JST基準の投稿日付が1日ずれる不具合があった。
  // 2026-03-15T23:30:00Z はJSTでは2026-03-16 08:30（UTCでは前日のまま）
  const unixSeconds = Date.UTC(2026, 2, 15, 23, 30, 0) / 1000;

  it("formatJstDate はUTCで前日でもJSTの日付を返す", () => {
    expect(formatJstDate(unixSeconds)).toBe("2026/3/16");
  });

  it("formatJstDateTime もJSTの日付・時刻を返す", () => {
    expect(formatJstDateTime(unixSeconds)).toBe("2026/3/16 8:30:00");
  });
});

describe("isValidDate", () => {
  // packages/contract の anniversaryDateSchema（couple.ts）が使う。
  // 従来はISO文字列をnew Date()でパースしてNaN判定していたが、
  // packages/date外でnew Date()を書けなくなった（L63のESLintルール）ため
  // daysInMonthベースの判定に置き換えた
  it("実在する日付はtrue", () => {
    expect(isValidDate("2026-01-15")).toBe(true);
  });

  it("31日を持たない月の31日はfalse", () => {
    expect(isValidDate("2026-04-31")).toBe(false);
  });

  it("平年の02-29はfalse", () => {
    expect(isValidDate("2026-02-29")).toBe(false);
  });

  it("うるう年の02-29はtrue", () => {
    expect(isValidDate("2024-02-29")).toBe(true);
  });

  it("月が範囲外はfalse", () => {
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-00-01")).toBe(false);
  });

  it("日が0以下はfalse", () => {
    expect(isValidDate("2026-01-00")).toBe(false);
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

describe("addMonths", () => {
  it("年をまたいで進む（011の月グリッド移動で使う）", () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it("年をまたいで戻る", () => {
    expect(addMonths(2027, 1, -1)).toEqual({ year: 2026, month: 12 });
  });

  it("同一年内の移動", () => {
    expect(addMonths(2026, 6, 1)).toEqual({ year: 2026, month: 7 });
  });
});

describe("monthsBefore / yearsBefore", () => {
  it("nヶ月前の日付を返す", () => {
    expect(monthsBefore("2026-03-15", 1)).toBe("2026-02-15");
  });

  it("年をまたいでnヶ月前を計算する", () => {
    expect(monthsBefore("2026-01-15", 1)).toBe("2025-12-15");
  });

  // 「存在しない日付は、その月の末日に寄せる」（architecture.md 5節。Aの決定)。
  // 素のDateは翌月へ繰り上げる（2026-03-31の1ヶ月前が2026-03-03になる）が、
  // それは採らない
  it("月末を超える日はその月の末日に寄せる（翌月へ繰り上げない）", () => {
    expect(monthsBefore("2026-03-31", 1)).toBe("2026-02-28");
  });

  // 3/29・3/30・3/31 の「1ヶ月前」は3日とも2/28になる（平年）。不具合ではなく
  // 月末の日数差から必然的にそうなる（architecture.md 5節・013タスクファイル）
  it("月末に近い日は複数の日から同じ月末日に寄る", () => {
    expect(monthsBefore("2026-03-30", 1)).toBe("2026-02-28");
    expect(monthsBefore("2026-03-29", 1)).toBe("2026-02-28");
  });

  it("n年前の日付を返す", () => {
    expect(yearsBefore("2026-03-15", 1)).toBe("2025-03-15");
  });

  // yearsBefore は monthsBefore(date, n*12) として同じ規則に乗る。
  // 個別実装すると、うるう日を平年へ寄せる規則が2箇所に分かれて食い違う
  // 経路が生まれていた（Rレビュー指摘で実際に発生。architecture.md 5節）
  it("うるう日から平年への1年前は02-28に寄せる", () => {
    expect(yearsBefore("2024-02-29", 1)).toBe("2023-02-28");
  });

  it("うるう日からうるう年への年前は02-29のまま", () => {
    expect(yearsBefore("2024-02-29", 4)).toBe("2020-02-29");
  });

  // architecture.md 5節の実例そのもの（Aの決定に添えられた反例）
  it("architecture.md 5節の実例: 2028-02-29の1年前は2027-02-28", () => {
    expect(yearsBefore("2028-02-29", 1)).toBe("2027-02-28");
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

  // 「存在しない日付は、その月の末日に寄せる」は02-29専用ではない一般則
  // （architecture.md 5節）。31日を持たない月（4月）への射影でも同じ規則が働く
  it("31日を持たない月への射影は末日に寄せる", () => {
    expect(projectMonthDay(4, 31, 2027)).toBe("2027-04-30");
  });
});

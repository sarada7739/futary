import { describe, expect, it } from "vitest";
import { buildMinuteOptions, HOUR_OPTIONS, joinTime, splitTime } from "../lib/time-wheel";

describe("HOUR_OPTIONS", () => {
  it("00〜23の24個、ゼロ詰め2桁", () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toBe("00");
    expect(HOUR_OPTIONS[23]).toBe("23");
  });
});

// 022・Aの決定: 刻み（5分）に乗らない既存の値を丸めず、選択肢へ差し込む。
// event.updateは全項目の置き換えのため、触っていない値を書き換えてはならない
describe("buildMinuteOptions", () => {
  it("刻みに乗る値（05）は12個のまま", () => {
    const options = buildMinuteOptions("05");
    expect(options).toHaveLength(12);
    expect(options).toContain("05");
  });

  it("刻みに乗らない値（07）は特別枠として追加され、位置は数値順になる", () => {
    const options = buildMinuteOptions("07");
    expect(options).toHaveLength(13);
    expect(options.indexOf("05")).toBeLessThan(options.indexOf("07"));
    expect(options.indexOf("07")).toBeLessThan(options.indexOf("10"));
  });

  it("00は既に刻みに乗っているため重複しない", () => {
    const options = buildMinuteOptions("00");
    expect(options.filter((o) => o === "00")).toHaveLength(1);
  });
});

describe("splitTime / joinTime", () => {
  it("HH:MMを時と分に分解できる", () => {
    expect(splitTime("12:07")).toEqual({ hour: "12", minute: "07" });
  });

  it("分解した値を結合すると元に戻る", () => {
    expect(joinTime("12", "07")).toBe("12:07");
  });
});

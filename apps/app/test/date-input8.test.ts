import { describe, expect, it } from "vitest";
import { digitsToDate, digitsToDisplay, toDigits } from "../lib/date-input8";

describe("toDigits", () => {
  it("数字以外を除去する。区切りは打たせない（022 B）", () => {
    expect(toDigits("2024-01-15")).toBe("20240115");
  });

  it("8桁を超えた分は切り詰める", () => {
    expect(toDigits("202401159999")).toBe("20240115");
  });
});

describe("digitsToDisplay", () => {
  it("8桁に満たないうちはハイフンを入れない（2024011を2024-01-1にしない）", () => {
    expect(digitsToDisplay("2024011")).toBe("2024011");
  });

  it("8桁そろった瞬間にYYYY-MM-DD形式になる", () => {
    expect(digitsToDisplay("20240115")).toBe("2024-01-15");
  });

  it("空文字はそのまま空文字", () => {
    expect(digitsToDisplay("")).toBe("");
  });
});

describe("digitsToDate", () => {
  it("8桁未満は日付として扱わない（空文字を返す）", () => {
    expect(digitsToDate("2024011")).toBe("");
  });

  it("存在する日付はYYYY-MM-DDになる", () => {
    expect(digitsToDate("20240115")).toBe("2024-01-15");
  });

  it("存在しない日付（2月30日）は拒む", () => {
    expect(digitsToDate("20240230")).toBe("");
  });

  it("うるう年の2月29日は通す", () => {
    expect(digitsToDate("20240229")).toBe("2024-02-29");
  });

  it("平年の2月29日は拒む", () => {
    expect(digitsToDate("20230229")).toBe("");
  });
});

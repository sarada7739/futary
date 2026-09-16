import { describe, expect, it } from "vitest";
import { WEATHER_CODES, WEATHER_ICON_KINDS, weatherIconsOf } from "../src/weather-codes";

// 058 T1: 天気コードの表（気象庁の TELOPS の全コード）に主の絵がある。「晴のち曇」→ 主 sun・副 cloud。
// 「曇時々雨」→ 主 cloud・副 rain。雷を含むコード → 副 thunder。無いコード → 主 cloud
describe("天気コード → 主 + 副の絵（058 T1）", () => {
  it("気象庁の全コード（118）に主の絵があり、主・副とも 5 つの絵のどれか", () => {
    const codes = Object.keys(WEATHER_CODES);
    expect(codes).toHaveLength(118);
    for (const code of codes) {
      expect(code).toMatch(/^\d{3}$/);
      const icons = WEATHER_CODES[code]!;
      expect(WEATHER_ICON_KINDS).toContain(icons.main);
      if (icons.sub !== null) expect(WEATHER_ICON_KINDS).toContain(icons.sub);
      expect(icons.name.length).toBeGreaterThan(0);
    }
    // 100（晴）〜 450（雪で雷を伴う）。よく使うコードがある
    for (const code of ["100", "101", "111", "200", "201", "203", "300", "313", "400", "450"]) expect(WEATHER_CODES[code]).toBeDefined();
  });

  it("晴のち曇（111）→ sun + cloud。曇時々雨（203）→ cloud + rain。晴（100）・曇（200）は副なし", () => {
    expect(weatherIconsOf("111")).toMatchObject({ main: "sun", sub: "cloud" });
    expect(weatherIconsOf("203")).toMatchObject({ main: "cloud", sub: "rain" });
    expect(weatherIconsOf("100")).toMatchObject({ main: "sun", sub: null });
    expect(weatherIconsOf("200")).toMatchObject({ main: "cloud", sub: null });
    expect(weatherIconsOf("300")).toMatchObject({ main: "rain", sub: null });
    expect(weatherIconsOf("400")).toMatchObject({ main: "snow", sub: null });
    // 「のち」も「時々」も同じ扱い（主 = 前半、副 = 後半）
    expect(weatherIconsOf("101")).toMatchObject({ main: "sun", sub: "cloud" }); // 晴時々曇
    expect(weatherIconsOf("211")).toMatchObject({ main: "cloud", sub: "sun" }); // 曇のち晴
    expect(weatherIconsOf("313")).toMatchObject({ main: "rain", sub: "cloud" }); // 雨のち曇
  });

  it("雷を含むコードは全部、副が thunder（主はそのまま）", () => {
    const thunder = Object.entries(WEATHER_CODES).filter(([, v]) => v.name.includes("雷"));
    expect(thunder.length).toBeGreaterThanOrEqual(8);
    for (const [code, v] of thunder) expect(v.sub, `${code} ${v.name}`).toBe("thunder");
    expect(weatherIconsOf("350")).toMatchObject({ main: "rain", sub: "thunder" }); // 雨で雷を伴う
    expect(weatherIconsOf("450")).toMatchObject({ main: "snow", sub: "thunder" });
    expect(weatherIconsOf("108")).toMatchObject({ main: "sun", sub: "thunder" }); // 晴一時雨か雷雨
    // 雷は主にならない（上段真ん中は使わない、とは別の話。雷は副だけ）
    for (const v of Object.values(WEATHER_CODES)) expect(v.main).not.toBe("thunder");
  });

  it("表に無いコード → 主 cloud・副なし。霧（209）は cloud。みぞれ（329 雨一時みぞれ）は snow", () => {
    expect(weatherIconsOf("999")).toEqual({ name: "不明", main: "cloud", sub: null });
    expect(weatherIconsOf("")).toEqual({ name: "不明", main: "cloud", sub: null });
    expect(weatherIconsOf("209")).toMatchObject({ main: "cloud", sub: null });
    expect(weatherIconsOf("329")).toMatchObject({ main: "rain", sub: "snow" });
  });
});

import { oc } from "@orpc/contract";
import { z } from "zod";

// YYYY-MM-DD（album.ts と同じ形）
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 058: カレンダーの天気と祝日（docs/tasks/058-weather-and-holidays.md 1節）。
// 天気は Worker が気象庁の予報 JSON を取る（予報区ごとに 1 時間キャッシュ）。失敗は days: []（エラーにしない）。
// 地域は個人ごと（couple_members.weather_area。位置情報は取らない）。ゲスト（デモ）は東京地方で固定

export const weatherAreaRefSchema = z.object({ code: z.string(), name: z.string() });
export type WeatherAreaRef = z.infer<typeof weatherAreaRefSchema>;

// 1 日分。code は気象庁の天気コード（3 桁）。気温が無い日は null
export const weatherDaySchema = z.object({
  date: z.string().regex(YMD_PATTERN),
  code: z.string(),
  tempMax: z.number().nullable(),
  tempMin: z.number().nullable(),
});
export type WeatherDay = z.infer<typeof weatherDaySchema>;

export const weatherForecastSchema = z.object({
  area: weatherAreaRefSchema.nullable(),
  days: z.array(weatherDaySchema),
});
export type WeatherForecast = z.infer<typeof weatherForecastSchema>;

const readErrors = {
  FORBIDDEN: {},
  NEEDS_ONBOARDING: { status: 409 },
} as const;

// weather.get: 自分の地域の 7 日分（今日から）。未設定なら area null・days []。失敗も days []
export const weatherGetContract = oc.input(z.object({})).output(weatherForecastSchema).errors(readErrors);

// weather.getForDate: 予定の詳細用。自分と相手の、その日の天気。7 日の外は両方 null。
// same = ふたりの地域が同じ（片方だけ設定なら false で、その側だけ非 null）
export const weatherForDateEntrySchema = z.object({ area: weatherAreaRefSchema, day: weatherDaySchema.nullable() });
export const weatherGetForDateContract = oc
  .input(z.object({ date: z.string().regex(YMD_PATTERN) }))
  .output(
    z.object({
      mine: weatherForDateEntrySchema.nullable(),
      partner: weatherForDateEntrySchema.nullable(),
      same: z.boolean(),
    }),
  )
  .errors(readErrors);

// holiday.list: その年の祝日（同梱の表 + holidays-jp の JSON を 1 日 1 回）。読み取り。ゲストも通る
export const holidayListContract = oc
  .input(z.object({ year: z.number().int().min(2000).max(2100) }))
  .output(z.object({ holidays: z.record(z.string(), z.string()) }))
  .errors(readErrors);

// me.updateWeatherArea: 自分の地域（表に無いコードは INVALID_INPUT。null で「設定しない」）
export const meUpdateWeatherAreaContract = oc
  .input(z.object({ areaCode: z.string().regex(/^\d{6}$/).nullable() }))
  .output(z.object({}))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    INVALID_INPUT: { status: 400 },
  });

import { Platform } from "react-native";
import type { WeatherDay } from "@futary/contract";
import { addDays } from "@futary/date";

// 058: カレンダーの天気（画面側の小さな計算と、「天気の地域を選ぶ ›」の帯を消した記憶）。
// 天気は今日から 7 日先まで（0節 #4）。判定はサーバ（weather.get の days）で、画面はその範囲の表示だけ

export const WEATHER_DAYS = 7;

// 今日から 7 日の中か（today・date は YYYY-MM-DD）
export function isWithinWeatherDays(date: string, today: string): boolean {
  return date >= today && date <= addDays(today, WEATHER_DAYS - 1);
}

export function weatherByDateOf(days: readonly WeatherDay[]): Record<string, WeatherDay> {
  const result: Record<string, WeatherDay> = {};
  for (const day of days) result[day.date] = day;
  return result;
}

// 最高気温の短い表示（無ければ空）
export function tempMaxLabel(day: WeatherDay): string {
  return day.tempMax === null ? "" : `${day.tempMax}°`;
}

// 予定の詳細の 1 行: 「晴のち曇・最高 25° / 最低 18°」（気温が無ければ名前だけ）
export function weatherDayLabel(name: string, day: WeatherDay): string {
  const temps = [day.tempMax === null ? null : `最高 ${day.tempMax}°`, day.tempMin === null ? null : `最低 ${day.tempMin}°`].filter(
    (s): s is string => s !== null,
  );
  return temps.length === 0 ? name : `${name}・${temps.join(" / ")}`;
}

// 「天気の地域を選ぶ ›」の帯を × で消したら端末に記憶（localStorage。043 と同じ作法。0節 #4）
export const WEATHER_PROMPT_DISMISSED_STORAGE_KEY = "futary.weatherPromptDismissed";

function localStorageOrNull(): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isWeatherPromptDismissed(): boolean {
  const store = localStorageOrNull();
  if (!store) return false;
  try {
    return store.getItem(WEATHER_PROMPT_DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissWeatherPrompt(): void {
  const store = localStorageOrNull();
  if (!store) return;
  try {
    store.setItem(WEATHER_PROMPT_DISMISSED_STORAGE_KEY, "1");
  } catch {
    // 書けなくても落とさない
  }
}

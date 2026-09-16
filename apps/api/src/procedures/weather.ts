import { weatherAreaName, type WeatherAreaRef, type WeatherDay } from "@futary/contract";
import { addDays, todayJst } from "@futary/date";
import { implementer } from "../implementer";
import { loadHolidays } from "../lib/holidays";
import { loadDays, WEATHER_DAYS } from "../lib/weather";
import { readProcedure } from "./base";

// 058: カレンダーの天気と祝日（docs/tasks/058-weather-and-holidays.md 1節）。読み取り（ゲストも通る）。
// 地域は個人ごと（couple_members.weather_area）。ゲスト（デモ）は東京地方で固定（0節 #12）。
// 取りに行くのは lib/weather.ts・lib/holidays.ts（固定の URL・キャッシュ・失敗は空）

export const DEMO_WEATHER_AREA = "130010"; // 東京地方

function areaRef(code: string | null): WeatherAreaRef | null {
  if (!code) return null;
  const name = weatherAreaName(code);
  return name ? { code, name } : null;
}

// 自分と相手の地域。readonly（ゲスト）はどちらも東京地方
async function loadAreas(
  db: D1Database,
  coupleId: string,
  userId: string | null,
): Promise<{ mine: string | null; partner: string | null }> {
  if (userId === null) return { mine: DEMO_WEATHER_AREA, partner: DEMO_WEATHER_AREA };
  const { results } = await db
    .prepare("SELECT user_id AS user_id, weather_area AS weather_area FROM couple_members WHERE couple_id = ?1")
    .bind(coupleId)
    .all<{ user_id: string; weather_area: string | null }>();
  let mine: string | null = null;
  let partner: string | null = null;
  for (const row of results) {
    if (row.user_id === userId) mine = row.weather_area;
    else partner = row.weather_area;
  }
  return { mine, partner };
}

const weatherGet = implementer.weather.get.use(readProcedure).handler(async ({ context }) => {
  const { mine } = await loadAreas(context.db, context.coupleId, context.userId);
  const area = areaRef(mine);
  if (!area) return { area: null, days: [] };
  return { area, days: await loadDays(area.code, Date.now(), context.externalFetch ?? fetch) };
});

const weatherGetForDate = implementer.weather.getForDate.use(readProcedure).handler(async ({ context, input }) => {
  const nowMs = Date.now();
  const today = todayJst(nowMs);
  const inRange = input.date >= today && input.date <= addDays(today, WEATHER_DAYS - 1);
  const { mine, partner } = await loadAreas(context.db, context.coupleId, context.userId);
  const mineArea = areaRef(mine);
  const partnerArea = areaRef(partner);
  const same = mineArea !== null && partnerArea !== null && mineArea.code === partnerArea.code;
  if (!inRange) {
    return { mine: null, partner: null, same };
  }
  const dayOf = async (area: WeatherAreaRef | null): Promise<WeatherDay | null> => {
    if (!area) return null;
    const days = await loadDays(area.code, nowMs, context.externalFetch ?? fetch);
    return days.find((d) => d.date === input.date) ?? null;
  };
  const [mineDay, partnerDay] = await Promise.all([dayOf(mineArea), same ? Promise.resolve(null) : dayOf(partnerArea)]);
  return {
    mine: mineArea ? { area: mineArea, day: mineDay } : null,
    partner: partnerArea ? { area: partnerArea, day: same ? mineDay : partnerDay } : null,
    same,
  };
});

const holidayList = implementer.holiday.list.use(readProcedure).handler(async ({ context, input }) => {
  return { holidays: await loadHolidays(input.year, Date.now(), context.externalFetch ?? fetch) };
});

export const weatherProcedures = { get: weatherGet, getForDate: weatherGetForDate };
export const holidayProcedures = { list: holidayList };

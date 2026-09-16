import { BUNDLED_HOLIDAYS } from "@futary/date";
import { z } from "zod";
import { LINK_PREVIEW_USER_AGENT } from "./link-preview";

// 058: 祝日。同梱の表（内閣府。packages/date/src/holidays.ts）+ holidays-jp の JSON を 1 日 1 回取って上書き
// （取れなければ同梱の表のまま）。2 つ目の口（security-requirements.md）: 固定の URL・12 秒・利用者の情報を送らない。
// 失敗しても投げない

export const HOLIDAYS_JP_URL = "https://holidays-jp.github.io/api/v1/date.json";
export const HOLIDAYS_FETCH_TIMEOUT_MS = 12_000;
export const HOLIDAYS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;

const holidaysSchema = z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string());

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

let cache: { at: number; ttl: number; holidays: Record<string, string> | null } | null = null;

export function resetHolidaysCache(): void {
  cache = null;
}

async function fetchHolidays(fetchImpl: FetchImpl): Promise<Record<string, string> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOLIDAYS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(HOLIDAYS_JP_URL, {
      signal: controller.signal,
      headers: { "user-agent": LINK_PREVIEW_USER_AGENT, accept: "application/json" },
    });
    if (!res.ok) return null;
    const parsed = holidaysSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// その年の祝日。外部の表が取れていれば同梱の表に上書き（同梱にしか無い日も残す）
export async function loadHolidays(year: number, nowMs: number, fetchImpl: FetchImpl = fetch): Promise<Record<string, string>> {
  if (!cache || nowMs - cache.at >= cache.ttl) {
    const fetched = await fetchHolidays(fetchImpl);
    cache = { at: nowMs, ttl: fetched === null ? FAILURE_TTL_MS : HOLIDAYS_CACHE_TTL_MS, holidays: fetched };
  }
  const prefix = `${year}-`;
  const result: Record<string, string> = {};
  for (const [date, name] of Object.entries(BUNDLED_HOLIDAYS)) if (date.startsWith(prefix)) result[date] = name;
  if (cache.holidays) {
    for (const [date, name] of Object.entries(cache.holidays)) if (date.startsWith(prefix)) result[date] = name;
  }
  return result;
}

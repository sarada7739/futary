import { WEATHER_AREAS, type WeatherDay } from "@futary/contract";
import { addDays, todayJst } from "@futary/date";
import { z } from "zod";
import { LINK_PREVIEW_USER_AGENT } from "./link-preview";

// 気象庁の予報 JSON を Worker が取る（security-requirements.md「外部 URL の取得」の 2 つ目の口。058）。
// - 行き先は固定の URL 1 つ。差し込むのは予報区の表（WEATHER_AREAS）にある office のコードだけ
// - 応答は Zod で形を確かめ、要る項目（天気コード・気温）だけ取り出す。12 秒で打ち切る
// - 失敗しても投げない（days: []）。利用者の情報は送らない
// - office ごとに 1 時間キャッシュ（Worker のメモリ）
//
// JSON の形（2026-09 に実測。正式な API ではないので変わりうる。変わったら黙って days: []）:
//   [ 短期（今日〜明後日）, 週間（今日〜7 日目） ]
//   短期.timeSeries[0].areas[i] = { area: { code: class10 }, weatherCodes: [...] }（timeDefines は日ごと）
//   短期.timeSeries[2].areas[i] = { area: { code: アメダス }, temps: [最低, 最高] }（今日の分）
//   週間.timeSeries[0].areas[i] = { area: { code: 週間の区域 }, weatherCodes: [...7] }
//   週間.timeSeries[1].areas[i] = { area: { code: アメダス }, tempsMax: [...7], tempsMin: [...7] }（今日の分は ""）

export const JMA_FORECAST_URL = "https://www.jma.go.jp/bosai/forecast/data/forecast/";
export const WEATHER_FETCH_TIMEOUT_MS = 12_000;
export const WEATHER_CACHE_TTL_MS = 60 * 60 * 1000;
export const WEATHER_DAYS = 7;

const areaSchema = z.object({ area: z.object({ code: z.string(), name: z.string().optional() }) }).passthrough();
const timeSeriesSchema = z.object({ timeDefines: z.array(z.string()), areas: z.array(areaSchema) });
const reportSchema = z.object({ timeSeries: z.array(timeSeriesSchema) }).passthrough();
const forecastSchema = z.array(reportSchema).min(1);

type Report = z.infer<typeof reportSchema>;

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

// office ごとのキャッシュ（失敗も短く覚えて連打しない: 1 時間の 1/6）
const FAILURE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; ttl: number; report: unknown | null }>();

export function resetWeatherCache(): void {
  cache.clear();
}

export function weatherCacheSize(): number {
  return cache.size;
}

async function fetchReport(office: string, fetchImpl: FetchImpl): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEATHER_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${JMA_FORECAST_URL}${office}.json`, {
      signal: controller.signal,
      headers: { "user-agent": LINK_PREVIEW_USER_AGENT, accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// office の予報（キャッシュ込み）。office は WEATHER_AREAS にあるものだけ（呼び出し側が表から引く）
export async function loadReport(office: string, nowMs: number, fetchImpl: FetchImpl = fetch): Promise<unknown | null> {
  const hit = cache.get(office);
  if (hit && nowMs - hit.at < hit.ttl) return hit.report;
  const report = await fetchReport(office, fetchImpl);
  cache.set(office, { at: nowMs, ttl: report === null ? FAILURE_TTL_MS : WEATHER_CACHE_TTL_MS, report });
  return report;
}

function dateOf(timeDefine: string): string {
  // "2026-09-17T00:00:00+09:00" → "2026-09-17"（気象庁の timeDefines は JST）
  return timeDefine.slice(0, 10);
}

function numberOrNull(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function findArea(ts: z.infer<typeof timeSeriesSchema>, code: string) {
  return ts.areas.find((a) => a.area.code === code) ?? null;
}

// 週間予報の区域は細分区域をまとめることがある（東京: 伊豆諸島北部 130020 + 南部 130030 → 伊豆諸島 130100）。
// 気象庁の week_area.json の week コードで引き、無ければ細分区域のコード、無ければ名前の前方一致
// （「伊豆諸島」は「伊豆諸島北部」の前）、それも無ければ最初の区域（office の主な区域）
function findWeeklyArea(ts: z.infer<typeof timeSeriesSchema>, weekCode: string, areaCode: string, areaName: string) {
  return (
    findArea(ts, weekCode) ??
    findArea(ts, areaCode) ??
    ts.areas.find((a) => a.area.name !== undefined && a.area.name.length > 0 && areaName.startsWith(a.area.name)) ??
    ts.areas[0] ??
    null
  );
}

// 予報 JSON から、予報区（class10）の 7 日分を組む。今日（JST）から WEATHER_DAYS 日。
// 短期の天気コードを優先し（細かい区域）、無い日は週間から。気温は今日 = 短期の temps[1]、他 = 週間の tempsMax/Min
export function extractDays(raw: unknown, areaCode: string, nowMs: number): WeatherDay[] {
  const parsed = forecastSchema.safeParse(raw);
  if (!parsed.success) return [];
  const area = WEATHER_AREAS[areaCode];
  if (!area) return [];
  const [short, weekly] = parsed.data as [Report, Report | undefined];

  const codes = new Map<string, string>();
  const tempMax = new Map<string, number | null>();
  const tempMin = new Map<string, number | null>();

  // 週間（先に入れて、短期で上書き）
  if (weekly) {
    const wts = weekly.timeSeries[0];
    const warea = wts ? findWeeklyArea(wts, area.week, areaCode, area.name) : null;
    const wcodes = z.array(z.string()).safeParse(warea?.["weatherCodes"]);
    if (wts && warea && wcodes.success) {
      wts.timeDefines.forEach((t, i) => {
        const c = wcodes.data[i];
        if (c) codes.set(dateOf(t), c);
      });
    }
    const tts = weekly.timeSeries[1];
    const tarea = tts && area.amedas ? findArea(tts, area.amedas) : null;
    const maxes = z.array(z.string()).safeParse(tarea?.["tempsMax"]);
    const mins = z.array(z.string()).safeParse(tarea?.["tempsMin"]);
    if (tts && tarea) {
      tts.timeDefines.forEach((t, i) => {
        const d = dateOf(t);
        if (maxes.success) tempMax.set(d, numberOrNull(maxes.data[i]));
        if (mins.success) tempMin.set(d, numberOrNull(mins.data[i]));
      });
    }
  }

  // 短期
  const sts = short.timeSeries[0];
  const sarea = sts ? findArea(sts, areaCode) : null;
  const scodes = z.array(z.string()).safeParse(sarea?.["weatherCodes"]);
  if (sts && sarea && scodes.success) {
    sts.timeDefines.forEach((t, i) => {
      const c = scodes.data[i];
      if (c) codes.set(dateOf(t), c);
    });
  }
  const stemps = short.timeSeries[2];
  const stArea = stemps && area.amedas ? findArea(stemps, area.amedas) : null;
  const temps = z.array(z.string()).safeParse(stArea?.["temps"]);
  if (stemps && stArea && temps.success) {
    // timeDefines は [今日 00:00, 今日 09:00] で temps は [最低, 最高]。同じ日なら 1 日分
    const d = stemps.timeDefines[0] ? dateOf(stemps.timeDefines[0]) : null;
    if (d) {
      const min = numberOrNull(temps.data[0]);
      const max = numberOrNull(temps.data[1]);
      if (max !== null) tempMax.set(d, max);
      if (min !== null) tempMin.set(d, min);
    }
  }

  const today = todayJst(nowMs);
  const days: WeatherDay[] = [];
  for (let i = 0; i < WEATHER_DAYS; i++) {
    const date = addDays(today, i);
    const code = codes.get(date);
    if (!code) continue;
    days.push({ date, code, tempMax: tempMax.get(date) ?? null, tempMin: tempMin.get(date) ?? null });
  }
  return days;
}

// 予報区の 7 日分。表に無いコードは fetch せず []（呼び出し側は表で検証しているが、二重に）
export async function loadDays(areaCode: string, nowMs: number, fetchImpl: FetchImpl = fetch): Promise<WeatherDay[]> {
  const area = WEATHER_AREAS[areaCode];
  if (!area) return [];
  const report = await loadReport(area.office, nowMs, fetchImpl);
  if (report === null) return [];
  return extractDays(report, areaCode, nowMs);
}

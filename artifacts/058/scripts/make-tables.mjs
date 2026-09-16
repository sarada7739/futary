// 058: 同梱の表を気象庁・内閣府の公開データから作る。
//   node artifacts/058/scripts/make-tables.mjs
// 出力:
//   packages/contract/src/weather-areas.ts  都道府県 → 予報区（class10）。予報区ごとに office（fetch する JSON）・
//                                           week（週間予報の区域コード）・amedas（気温の観測点）
//   packages/ui/src/weather-codes.ts        天気コード → 主 + 副の絵（気象庁の TELOPS の名前から機械的に）
//   packages/date/src/holidays.ts           祝日（内閣府 syukujitsu.csv。今年〜来年）
// 元データは取り直す（同梱しない）。取れないときは scratchpad の写しを使う
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const cache = path.join(here, ".cache");
mkdirSync(cache, { recursive: true });

async function get(name, url, decode = (b) => new TextDecoder("utf-8").decode(b)) {
  const file = path.join(cache, name);
  try {
    const res = await fetch(url, { headers: { "user-agent": "nisoine-link-preview/1 (+https://nisoine.com)" } });
    if (!res.ok) throw new Error(`${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    writeFileSync(file, bytes);
    return decode(bytes);
  } catch (e) {
    if (existsSync(file)) return decode(readFileSync(file));
    throw e;
  }
}

// --- 予報区 -----------------------------------------------------------------------------
const area = JSON.parse(await get("area.json", "https://www.jma.go.jp/bosai/common/const/area.json"));
const weekArea = JSON.parse(await get("week_area.json", "https://www.jma.go.jp/bosai/forecast/const/week_area.json"));
const forecastArea = JSON.parse(await get("forecast_area.json", "https://www.jma.go.jp/bosai/forecast/const/forecast_area.json"));

// 都道府県の名前: office の名前をそのまま。北海道の 7 官署は「北海道」、鹿児島の 2 つは「鹿児島県」、沖縄の 4 つは「沖縄県」
function prefectureOf(officeCode, office) {
  if (office.parent === "010100") return "北海道";
  if (officeCode === "460040" || officeCode === "460100") return "鹿児島県";
  if (office.parent === "011100") return "沖縄県";
  return office.name;
}

const areas = {};
const prefectures = [];
const prefIndex = new Map();
// JS のオブジェクトは "100000" のような整数の形のキーを先に並べる（"011000" は整数の形でない）ので、コードで並べ直す
for (const [officeCode, office] of Object.entries(area.offices).sort(([a], [b]) => a.localeCompare(b))) {
  const pref = prefectureOf(officeCode, office);
  if (!prefIndex.has(pref)) {
    prefIndex.set(pref, prefectures.length);
    prefectures.push({ name: pref, areas: [] });
  }
  const wk = new Map((weekArea[officeCode] ?? []).map((w) => [w.srf, w]));
  const fa = new Map((forecastArea[officeCode] ?? []).map((f) => [f.class10, f]));
  for (const code of office.children) {
    const c10 = area.class10s[code];
    if (!c10) continue;
    const w = wk.get(code);
    const f = fa.get(code);
    areas[code] = { name: c10.name, office: officeCode, week: w?.week ?? code, amedas: w?.amedas ?? f?.amedas?.[0] ?? null };
    prefectures[prefIndex.get(pref)].areas.push(code);
  }
}

const areasTs = `// 058: 気象庁の予報区（class10 = 一次細分区域）。artifacts/058/scripts/make-tables.mjs が
// 気象庁の area.json・week_area.json・forecast_area.json から作る（手で直さない。作り直す）。
// 利用者が選ぶのはこの表のコードだけ（表に無いコードは INVALID_INPUT。security-requirements.md の 2 つ目の口）。
// office = fetch する予報 JSON（forecast/{office}.json）、week = 週間予報の区域コード、amedas = 気温の観測点

export interface WeatherArea {
  name: string;
  office: string;
  week: string;
  amedas: string | null;
}

export const WEATHER_AREAS: Readonly<Record<string, WeatherArea>> = ${JSON.stringify(areas, null, 2)};

// 都道府県 → 予報区のコード（マイページの 2 段の選択。並びは気象庁の順）
export const WEATHER_PREFECTURES: ReadonlyArray<{ name: string; areas: readonly string[] }> = ${JSON.stringify(prefectures, null, 2)};

export function isWeatherAreaCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(WEATHER_AREAS, code);
}

export function weatherAreaName(code: string): string | null {
  return WEATHER_AREAS[code]?.name ?? null;
}
`;
writeFileSync(path.join(root, "packages/contract/src/weather-areas.ts"), areasTs);
console.log("weather-areas.ts:", Object.keys(areas).length, "areas /", prefectures.length, "prefectures");

// --- 天気コード ------------------------------------------------------------------------
// 予報ページの JS に埋め込まれた TELOPS（{code: [昼の絵, 夜の絵, 基本コード, 日本語, 英語]}）を抜く
const page = await get("forecast.html", "https://www.jma.go.jp/bosai/forecast/");
const m = page.match(/TELOPS=(\{.*?\})[;,]/s);
if (!m) throw new Error("TELOPS が見つからない");
const telops = JSON.parse(m[1].replace(/([{,])(\d+):/g, '$1"$2":'));

// 主 = 名前の最初の天気の語。副 = 次の（違う）語。雷があれば副は雷（タスク定義 0節 #7）。
// 霧・みぞれ: 霧は曇、みぞれは雪。「大雨」「暴風雪」「風雪」は主だけ
const TOKENS = [
  ["晴", "sun"],
  ["曇", "cloud"],
  ["雨", "rain"],
  ["雪", "snow"],
  ["みぞれ", "snow"],
  ["霧", "cloud"],
];
function iconsOf(name) {
  const found = [];
  for (let i = 0; i < name.length; i++) {
    for (const [word, icon] of TOKENS) {
      if (name.startsWith(word, i)) {
        found.push(icon);
        i += word.length - 1;
        break;
      }
    }
  }
  const main = found[0] ?? "cloud";
  let sub = null;
  if (name.includes("雷")) sub = "thunder";
  else sub = found.find((x) => x !== main) ?? null;
  return { main, sub };
}
const codes = {};
for (const [code, entry] of Object.entries(telops)) {
  codes[code] = { name: entry[3], ...iconsOf(entry[3]) };
}
const codesTs = `// 058: 気象庁の天気コード → 主 + 副の絵（タスク定義 0節 #7）。artifacts/058/scripts/make-tables.mjs が
// 予報ページの TELOPS（全コード）の日本語の名前から機械的に作る（手で直さない。作り直す）。
// 主 = 名前の最初の天気の語、副 = 次の違う語。雷を含めば副は雷。霧は曇、みぞれは雪。
// 表に無いコードは主 = 曇で倒す（weatherIconsOf）

export const WEATHER_ICON_KINDS = ["sun", "cloud", "rain", "snow", "thunder"] as const;
export type WeatherIconKind = (typeof WEATHER_ICON_KINDS)[number];

export interface WeatherIcons {
  name: string;
  main: WeatherIconKind;
  sub: WeatherIconKind | null;
}

export const WEATHER_CODES: Readonly<Record<string, WeatherIcons>> = ${JSON.stringify(codes, null, 2)};

export function weatherIconsOf(code: string): WeatherIcons {
  return WEATHER_CODES[code] ?? { name: "不明", main: "cloud", sub: null };
}
`;
writeFileSync(path.join(root, "packages/ui/src/weather-codes.ts"), codesTs);
console.log("weather-codes.ts:", Object.keys(codes).length, "codes");

// --- 祝日 -----------------------------------------------------------------------------
const csv = await get("syukujitsu.csv", "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv", (b) => new TextDecoder("shift_jis").decode(b));
const thisYear = new Date().getFullYear();
const holidays = {};
for (const line of csv.split(/\r?\n/).slice(1)) {
  const [ymd, name] = line.split(",");
  if (!ymd || !name) continue;
  const [y, mo, d] = ymd.split("/").map(Number);
  if (y < thisYear || y > thisYear + 1) continue;
  holidays[`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`] = name.trim();
}
const holidaysTs = `// 058: 同梱の祝日（内閣府 syukujitsu.csv。${thisYear}〜${thisYear + 1} 年）。artifacts/058/scripts/make-tables.mjs が
// 作る（手で直さない。年に 1 度作り直すとよいが、しなくても Worker が holidays-jp の JSON で上書きする。
// タスク定義 0節 #9）。「休日」は振替休日・国民の休日（内閣府の表の名前のまま）

export const BUNDLED_HOLIDAYS: Readonly<Record<string, string>> = ${JSON.stringify(holidays, null, 2)};
`;
writeFileSync(path.join(root, "packages/date/src/holidays.ts"), holidaysTs);
console.log("holidays.ts:", Object.keys(holidays).length, "days");

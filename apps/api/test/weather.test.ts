import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { WEATHER_AREAS, WEATHER_PREFECTURES, isWeatherAreaCode } from "@futary/contract";
import { BUNDLED_HOLIDAYS, addDays, todayJst } from "@futary/date";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";
import {
  extractDays,
  JMA_FORECAST_URL,
  loadDays,
  resetWeatherCache,
  weatherCacheSize,
  WEATHER_CACHE_TTL_MS,
  WEATHER_FETCH_TIMEOUT_MS,
} from "../src/lib/weather";
import { HOLIDAYS_JP_URL, loadHolidays, resetHolidaysCache } from "../src/lib/holidays";
import { DEMO_WEATHER_AREA } from "../src/procedures/weather";
import tokyoJson from "./fixtures/weather/130000.json?raw";
import landingPrivacyHtml from "../../landing/privacy.html?raw";

// 058: カレンダーの天気と祝日（docs/tasks/058-weather-and-holidays.md 3節 T2〜T6・T8）。
// 気象庁の JSON は 2026-09-16 17:00 発表の東京都（130000）の写し（fixtures/weather/130000.json）。
// 外部の fetch は context.externalFetch で差し替える（本物の気象庁には行かない）

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

const r2Sign: RpcContext["r2Sign"] = {
  accountId: "test-account",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  bucketName: "test-bucket",
};

type TestUser = { id: string; name: string; email: string };
let userSeq = 0;

async function createUser(): Promise<TestUser> {
  userSeq += 1;
  const id = `weather-user-${userSeq}-${crypto.randomUUID()}`;
  const name = `テストユーザー${userSeq}`;
  const email = `weather-user-${userSeq}-${crypto.randomUUID()}@example.com`;
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db
      .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)")
      .bind(id, name, email, now),
    db
      .prepare(
        "INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at) VALUES (?1, 'google', ?2, 'google', ?3, ?4, ?4)",
      )
      .bind(crypto.randomUUID(), `google-sub-${id}`, id, now),
  ]);
  return { id, name, email };
}

// 固定の応答を返す fetch。呼ばれた URL を記録する
function fakeFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push(url);
    return handler(url, init);
  });
  return { impl, calls };
}
const okJson = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
const tokyoFetch = () =>
  fakeFetch((url, init) => {
    // R の記録 2: 気象庁への fetch もヘッダは UA（040 と同じ）と accept だけ（Cookie・利用者の情報は送らない）
    expect(init.headers).toEqual({ "user-agent": "nisoine-link-preview/1 (+https://nisoine.com)", accept: "application/json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    return url === `${JMA_FORECAST_URL}130000.json` ? okJson(tokyoJson) : new Response("nf", { status: 404 });
  });

function contextFor(user: TestUser | null, externalFetch: RpcContext["externalFetch"], demoCoupleId: string | null = null): RpcContext {
  return {
    db,
    bucket,
    r2Sign,
    aiEnv: { provider: "openai", openaiApiKey: "test-openai-key" },
    externalFetch,
    user: user ? { ...user, image: null } : null,
    ip: "203.0.113.1",
    demoCoupleId,
    sessionCreatedAt: user ? Date.now() : null,
    authSecret: "test-secret",
  };
}

async function createPair(fetchImpl: RpcContext["externalFetch"]): Promise<{ owner: TestUser; partner: TestUser; coupleId: string }> {
  const owner = await createUser();
  const partner = await createUser();
  const couple = await call(router.couple.create, {}, { context: contextFor(owner, fetchImpl) });
  const invite = await call(router.invite.issue, undefined, { context: contextFor(owner, fetchImpl) });
  await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner, fetchImpl) });
  return { owner, partner, coupleId: couple.id };
}

async function createDemoPair(): Promise<string> {
  const user = await createUser();
  const coupleId = `demo-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db
      .prepare("INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (?1, '2025-01-01', NULL, 'dating', 1, ?2)")
      .bind(coupleId, now),
    db.prepare("INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES (?1, ?2, 1, ?3)").bind(coupleId, user.id, now),
  ]);
  return coupleId;
}

// 写しは 2026-09-16 17:00 発表（短期は 09-16〜18、週間は 09-17〜23）。「今」は 2026-09-17 12:00 JST に固定
const NOW_MS = Date.UTC(2026, 8, 17, 3, 0, 0);

beforeEach(() => {
  resetWeatherCache();
  resetHolidaysCache();
});

describe("058: 予報区の表（同梱）", () => {
  it("142 の予報区・47 の都道府県。東京地方は 130010（office 130000・週間 130010・アメダス 44132）", () => {
    expect(Object.keys(WEATHER_AREAS)).toHaveLength(142);
    expect(WEATHER_PREFECTURES).toHaveLength(47);
    expect(WEATHER_PREFECTURES.map((p) => p.name).slice(0, 3)).toEqual(["北海道", "青森県", "岩手県"]);
    expect(WEATHER_AREAS["130010"]).toEqual({ name: "東京地方", office: "130000", week: "130010", amedas: "44132" });
    // week_area.json は 130020 → 130020 と言うが週間予報には 130100（伊豆諸島）しか無い。lib/weather.ts が名前で倒す
    expect(WEATHER_AREAS["130020"]).toMatchObject({ name: "伊豆諸島北部", office: "130000", amedas: "44172" });
    expect(WEATHER_PREFECTURES.find((p) => p.name === "東京都")?.areas).toEqual(["130010", "130020", "130030", "130040"]);
    expect(WEATHER_PREFECTURES.find((p) => p.name === "北海道")?.areas.length).toBeGreaterThan(10);
    expect(isWeatherAreaCode("130010")).toBe(true);
    expect(isWeatherAreaCode("130000")).toBe(false);
    expect(isWeatherAreaCode("999999")).toBe(false);
    // 全部の予報区が都道府県のどれかに入っている
    const inPref = new Set(WEATHER_PREFECTURES.flatMap((p) => p.areas));
    expect([...inPref].sort()).toEqual(Object.keys(WEATHER_AREAS).sort());
    // 6 桁の数字だけ
    for (const code of Object.keys(WEATHER_AREAS)) expect(code).toMatch(/^\d{6}$/);
  });
});

describe("058 T2: weather.get（固定の応答から 7 日分。失敗は days []。予報区ごとに 1 時間キャッシュ）", () => {
  it("extractDays: 東京地方 = 09-17〜23 の 7 日。短期の天気コードを優先し、今日の気温は短期の temps、他は週間の tempsMax/Min", () => {
    const days = extractDays(JSON.parse(tokyoJson), "130010", NOW_MS);
    expect(days.map((d) => d.date)).toEqual(["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"]);
    // 短期: 09-17 は 313、09-18 は 200（週間の 09-17 は 313・09-18 は 200 と同じ）。09-19 以降は週間
    expect(days[0]).toEqual({ date: "2026-09-17", code: "313", tempMax: 23, tempMin: 19 });
    expect(days[1]).toEqual({ date: "2026-09-18", code: "200", tempMax: 25, tempMin: 18 });
    expect(days[6]).toEqual({ date: "2026-09-23", code: "200", tempMax: 27, tempMin: 21 });
    // 伊豆諸島北部: 短期は 130020、週間は 130100（伊豆諸島）に倒れ、気温は大島（44172。週間に無い → null）
    const izu = extractDays(JSON.parse(tokyoJson), "130020", NOW_MS);
    expect(izu.map((d) => d.code)).toEqual(["313", "200", "202", "203", "203", "202", "200"]);
    expect(izu[0]).toMatchObject({ tempMax: 23, tempMin: 20 });
    expect(izu[1]).toMatchObject({ tempMax: null, tempMin: null });
  });

  it("extractDays: 発表から日が経って今日が範囲の外なら残りだけ。形が違えば []。表に無いコードは []", () => {
    // 09-22 に見ると 09-22・09-23 の 2 日だけ（過去は出さない）
    const later = extractDays(JSON.parse(tokyoJson), "130010", Date.UTC(2026, 8, 22, 3, 0, 0));
    expect(later.map((d) => d.date)).toEqual(["2026-09-22", "2026-09-23"]);
    expect(extractDays({ nope: true }, "130010", NOW_MS)).toEqual([]);
    expect(extractDays([{ timeSeries: [] }], "130010", NOW_MS)).toEqual([]);
    expect(extractDays(JSON.parse(tokyoJson), "130000", NOW_MS)).toEqual([]);
  });

  it("weather.get: 地域を設定した利用者は area と 7 日分。未設定は area null・days []", async () => {
    // 手続きは Date.now() で「今日」を決める。写しの週間（09-17〜23）の中に「今」を固定する
    // （本物の今日だと 09-24 以降は days が 0 件になる）。Date だけを差し替え、タイマーは本物のまま
    vi.setSystemTime(NOW_MS);
    try {
      const { impl } = tokyoFetch();
      const pair = await createPair(impl);
      const ctx = contextFor(pair.owner, impl);
      expect(await call(router.weather.get, {}, { context: ctx })).toEqual({ area: null, days: [] });
      await call(router.me.updateWeatherArea, { areaCode: "130010" }, { context: ctx });
      const result = await call(router.weather.get, {}, { context: ctx });
      expect(result.area).toEqual({ code: "130010", name: "東京地方" });
      expect(result.days).toHaveLength(7);
      expect(result.days[0]).toMatchObject({ date: todayJst(NOW_MS), code: expect.any(String) });
      // couple.get にも自分の地域
      expect((await call(router.couple.get, undefined, { context: ctx })).weatherArea).toEqual({ code: "130010", name: "東京地方" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("気象庁が落ちている（5xx・タイムアウト・形が違う）→ days: [] で通る（投げない）", async () => {
    const pair = await createPair(fakeFetch(() => okJson(tokyoJson)).impl);
    await call(router.me.updateWeatherArea, { areaCode: "130010" }, { context: contextFor(pair.owner, fakeFetch(() => okJson(tokyoJson)).impl) });

    const server5xx = fakeFetch(() => new Response("bad", { status: 503 }));
    expect(await call(router.weather.get, {}, { context: contextFor(pair.owner, server5xx.impl) })).toEqual({
      area: { code: "130010", name: "東京地方" },
      days: [],
    });
    resetWeatherCache();
    const wrongShape = fakeFetch(() => okJson(JSON.stringify({ hello: "world" })));
    expect((await call(router.weather.get, {}, { context: contextFor(pair.owner, wrongShape.impl) })).days).toEqual([]);
    resetWeatherCache();
    // タイムアウト: signal が abort されたら AbortError を投げる fetch（12 秒は待たず、abort を即座に受ける）
    const slow = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.useFakeTimers();
    try {
      const pending = loadDays("130010", NOW_MS, slow.impl);
      await vi.advanceTimersByTimeAsync(WEATHER_FETCH_TIMEOUT_MS + 1);
      expect(await pending).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("予報区（office）ごとに 1 時間キャッシュ: 2 回目は fetch しない。TTL を過ぎると取り直す。別の office は別に取る", async () => {
    const { impl, calls } = tokyoFetch();
    await loadDays("130010", NOW_MS, impl);
    await loadDays("130020", NOW_MS + 1000, impl); // 同じ office（130000）
    expect(calls).toEqual([`${JMA_FORECAST_URL}130000.json`]);
    expect(weatherCacheSize()).toBe(1);
    await loadDays("130010", NOW_MS + WEATHER_CACHE_TTL_MS + 1, impl);
    expect(calls).toHaveLength(2);
    // 別の office（神奈川 140000）は 404 → [] だが、URL は固定の形
    expect(await loadDays("140010", NOW_MS, impl)).toEqual([]);
    expect(calls[2]).toBe(`${JMA_FORECAST_URL}140000.json`);
  });
});

describe("058 T3: fetch する URL は固定の 2 つだけ。差し込むのは表にあるコードだけ", () => {
  it("me.updateWeatherArea: 表に無いコード（office のコード・存在しない 6 桁）は INVALID_INPUT で、weather.get は fetch しない", async () => {
    const { impl, calls } = tokyoFetch();
    const pair = await createPair(impl);
    const ctx = contextFor(pair.owner, impl);
    await expect(call(router.me.updateWeatherArea, { areaCode: "130000" }, { context: ctx })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call(router.me.updateWeatherArea, { areaCode: "999999" }, { context: ctx })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // 6 桁でない・数字でない は契約で弾く
    await expect(call(router.me.updateWeatherArea, { areaCode: "../x" }, { context: ctx })).rejects.toBeTruthy();
    expect(await call(router.weather.get, {}, { context: ctx })).toEqual({ area: null, days: [] });
    expect(calls).toEqual([]);
    // 表に無いコードが DB に直接入っていても fetch しない（loadDays の二重の守り）
    await db.prepare("UPDATE couple_members SET weather_area = '999999' WHERE user_id = ?1").bind(pair.owner.id).run();
    expect(await call(router.weather.get, {}, { context: ctx })).toEqual({ area: null, days: [] });
    expect(calls).toEqual([]);
    // R の記録 1: loadDays の二重の弾き（表に無いコードを直接渡しても fetch せず []）
    expect(await loadDays("999999", NOW_MS, impl)).toEqual([]);
    expect(await loadDays("130000", NOW_MS, impl)).toEqual([]);
    expect(calls).toEqual([]);
    // 表にあるコードなら URL は JMA_FORECAST_URL + office + ".json" だけ
    await call(router.me.updateWeatherArea, { areaCode: "130010" }, { context: ctx });
    await call(router.weather.get, {}, { context: ctx });
    expect(calls).toEqual([`${JMA_FORECAST_URL}130000.json`]);
    // null で「設定しない」
    await call(router.me.updateWeatherArea, { areaCode: null }, { context: ctx });
    expect((await call(router.couple.get, undefined, { context: ctx })).weatherArea).toBeNull();
  });

  it("holiday.list の URL は HOLIDAYS_JP_URL だけ。利用者の情報（クエリ・Cookie）を付けない", async () => {
    const { impl, calls } = fakeFetch((url, init) => {
      expect(init.headers).toEqual({ "user-agent": "nisoine-link-preview/1 (+https://nisoine.com)", accept: "application/json" });
      return url === HOLIDAYS_JP_URL ? okJson(JSON.stringify({ "2026-01-01": "元日" })) : new Response("nf", { status: 404 });
    });
    const pair = await createPair(impl);
    await call(router.holiday.list, { year: 2026 }, { context: contextFor(pair.owner, impl) });
    expect(calls).toEqual([HOLIDAYS_JP_URL]);
  });
});

describe("058 T4・T6: weather.getForDate（予定の詳細）", () => {
  // 手続きの「今日」（Date.now()）を写しの週間の中に固定する（weather.get のテストと同じ理由）
  const today = todayJst(NOW_MS);
  beforeEach(() => {
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("同じ地域 → same true で両方に同じ day。片方未設定 → その側 null・same false。地域が違えば 2 つ。8 日先 → 両方 null", async () => {
    const { impl } = tokyoFetch();
    const pair = await createPair(impl);
    const mine = contextFor(pair.owner, impl);
    const theirs = contextFor(pair.partner, impl);
    await call(router.me.updateWeatherArea, { areaCode: "130010" }, { context: mine });

    // 相手は未設定
    const half = await call(router.weather.getForDate, { date: today }, { context: mine });
    expect(half.same).toBe(false);
    expect(half.mine?.area).toEqual({ code: "130010", name: "東京地方" });
    expect(half.partner).toBeNull();
    // 相手から見ると自分（相手）が null で、partner（owner）が出る
    const fromPartner = await call(router.weather.getForDate, { date: today }, { context: theirs });
    expect(fromPartner.mine).toBeNull();
    expect(fromPartner.partner?.area.code).toBe("130010");

    // 同じ地域
    await call(router.me.updateWeatherArea, { areaCode: "130010" }, { context: theirs });
    const same = await call(router.weather.getForDate, { date: today }, { context: mine });
    expect(same.same).toBe(true);
    expect(same.mine?.area.code).toBe("130010");
    expect(same.partner?.area.code).toBe("130010");
    expect(same.partner?.day).toEqual(same.mine?.day);

    // 違う地域（伊豆諸島北部）
    await call(router.me.updateWeatherArea, { areaCode: "130020" }, { context: theirs });
    const diff = await call(router.weather.getForDate, { date: today }, { context: mine });
    expect(diff.same).toBe(false);
    expect(diff.mine?.area.name).toBe("東京地方");
    expect(diff.partner?.area.name).toBe("伊豆諸島北部");

    // 8 日先は両方 null（same は地域の比較のまま）
    const far = await call(router.weather.getForDate, { date: addDays(today, 7) }, { context: mine });
    expect(far).toEqual({ mine: null, partner: null, same: false });
    // 昨日も null
    expect((await call(router.weather.getForDate, { date: addDays(today, -1) }, { context: mine })).mine).toBeNull();
  });

  it("T6: 別ペアの相手の地域を返さない（couple_id スコープ）", async () => {
    const { impl } = tokyoFetch();
    const a = await createPair(impl);
    const b = await createPair(impl);
    await call(router.me.updateWeatherArea, { areaCode: "130020" }, { context: contextFor(b.owner, impl) });
    await call(router.me.updateWeatherArea, { areaCode: "130030" }, { context: contextFor(b.partner, impl) });
    const r = await call(router.weather.getForDate, { date: today }, { context: contextFor(a.owner, impl) });
    expect(r).toEqual({ mine: null, partner: null, same: false });
    await call(router.me.updateWeatherArea, { areaCode: "130010" }, { context: contextFor(a.owner, impl) });
    const r2 = await call(router.weather.getForDate, { date: today }, { context: contextFor(a.owner, impl) });
    expect(r2.partner).toBeNull();
  });

  it("ゲスト（デモ）は東京地方で固定（0節 #12）: weather.get・getForDate（same true）・couple.get", async () => {
    const { impl } = tokyoFetch();
    const demo = await createDemoPair();
    const ctx = contextFor(null, impl, demo);
    expect(DEMO_WEATHER_AREA).toBe("130010");
    expect((await call(router.weather.get, {}, { context: ctx })).area).toEqual({ code: "130010", name: "東京地方" });
    const r = await call(router.weather.getForDate, { date: today }, { context: ctx });
    expect(r.same).toBe(true);
    expect(r.mine?.area.code).toBe("130010");
    expect((await call(router.couple.get, undefined, { context: ctx })).weatherArea).toEqual({ code: "130010", name: "東京地方" });
    // ゲストは地域を変えられない
    await expect(call(router.me.updateWeatherArea, { areaCode: "130020" }, { context: ctx })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("058 T5: holiday.list（同梱の表 + holidays-jp で上書き）", () => {
  it("同梱の表に今年と来年の祝日がある（元日・成人の日 …）", () => {
    const year = new Date().getFullYear();
    expect(BUNDLED_HOLIDAYS[`${year}-01-01`]).toBe("元日");
    expect(BUNDLED_HOLIDAYS[`${year + 1}-01-01`]).toBe("元日");
    expect(Object.keys(BUNDLED_HOLIDAYS).filter((d) => d.startsWith(`${year}-`)).length).toBeGreaterThanOrEqual(15);
  });

  it("外部の JSON が取れれば上書き（名前が変わる・同梱に無い日が足される）。取れなければ同梱のまま。1 日 1 回", async () => {
    const year = new Date().getFullYear();
    const failing = fakeFetch(() => new Response("bad", { status: 500 }));
    const fromBundle = await loadHolidays(year, NOW_MS, failing.impl);
    expect(fromBundle[`${year}-01-01`]).toBe("元日");
    expect(fromBundle).toEqual(Object.fromEntries(Object.entries(BUNDLED_HOLIDAYS).filter(([d]) => d.startsWith(`${year}-`))));

    resetHolidaysCache();
    const external = fakeFetch(() => okJson(JSON.stringify({ [`${year}-01-01`]: "元日（外部）", [`${year}-12-30`]: "試験の休日", "2019-05-01": "昔の日" })));
    const merged = await loadHolidays(year, NOW_MS, external.impl);
    expect(merged[`${year}-01-01`]).toBe("元日（外部）");
    expect(merged[`${year}-12-30`]).toBe("試験の休日");
    expect(merged[`${year}-02-11`]).toBe("建国記念の日"); // 同梱にしか無い日は残る
    expect(merged["2019-05-01"]).toBeUndefined(); // 他の年は返さない
    // 1 日 1 回: 同じ日のうちは fetch しない
    await loadHolidays(year, NOW_MS + 60 * 60 * 1000, external.impl);
    expect(external.calls).toHaveLength(1);
    await loadHolidays(year, NOW_MS + 24 * 60 * 60 * 1000 + 1, external.impl);
    expect(external.calls).toHaveLength(2);
    // 形が違う JSON は無視して同梱のまま
    resetHolidaysCache();
    const wrong = fakeFetch(() => okJson(JSON.stringify({ "not-a-date": "x" })));
    expect((await loadHolidays(year, NOW_MS, wrong.impl))[`${year}-01-01`]).toBe("元日");
  });

  it("holiday.list（手続き）: ゲストも通る", async () => {
    const demo = await createDemoPair();
    const { impl } = fakeFetch(() => new Response("bad", { status: 500 }));
    const year = new Date().getFullYear();
    const r = await call(router.holiday.list, { year }, { context: contextFor(null, impl, demo) });
    expect(r.holidays[`${year}-01-01`]).toBe("元日");
  });
});

describe("058 T8: /privacy に地域の行と「天気と祝日について」", () => {
  it("1 節の行（予報区・位置情報は取得しません）と 3 節の見出し・気象庁・内閣府・送りません", () => {
    expect(landingPrivacyHtml).toContain("天気を出すために選んだ地域");
    expect(landingPrivacyHtml).toContain("位置情報は取得しません");
    expect(landingPrivacyHtml).toContain("天気と祝日について");
    expect(landingPrivacyHtml).toContain("気象庁");
    expect(landingPrivacyHtml).toContain("内閣府");
    expect(landingPrivacyHtml).toMatch(/気象庁や第三者に送りません/);
  });
});

import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

// post.test.ts と同じ理由（実際の R2 API トークンの設定有無にテストの合否を左右させない）
const r2Sign: RpcContext["r2Sign"] = {
  accountId: "test-account",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  bucketName: "test-bucket",
};

let userSeq = 0;

async function createUser(): Promise<{ id: string; name: string; email: string }> {
  userSeq += 1;
  const id = `user-${userSeq}-${crypto.randomUUID()}`;
  const name = `テストユーザー${userSeq}`;
  const email = `user-${userSeq}-${crypto.randomUUID()}@example.com`;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    )
    .bind(id, name, email, now)
    .run();
  return { id, name, email };
}

function contextFor(
  user: { id: string; name: string; email: string } | null,
  demoCoupleId: string | null = null,
): RpcContext {
  return { db, bucket, r2Sign, user: user ? { ...user, image: null } : null, ip: "203.0.113.1", demoCoupleId };
}

async function createCouple(user: { id: string; name: string; email: string }) {
  return call(router.couple.create, { anniversaryDate: "2020-01-01" }, { context: contextFor(user) });
}

async function createEvent(
  user: { id: string; name: string; email: string },
  overrides: Partial<{ date: string; title: string; kind: "anniversary" | "plan" | "meetup"; repeatYearly: boolean }> = {},
) {
  return call(
    router.event.create,
    {
      date: overrides.date ?? "2020-01-15",
      title: overrides.title ?? "テストイベント",
      kind: overrides.kind ?? "plan",
      repeatYearly: overrides.repeatYearly ?? false,
    },
    { context: contextFor(user) },
  );
}

describe("event.create / event.list（基本のCRUD）", () => {
  it("作成した予定・会った日がそのまま一覧に出る（repeatYearly=false は射影しない）", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createEvent(user, { date: "2026-03-10", title: "水族館デート", kind: "meetup" });

    const result = await call(
      router.event.list,
      { from: "2026-03-01", to: "2026-03-31" },
      { context: contextFor(user) },
    );

    expect(result.items).toEqual([
      {
        id: created.id,
        date: "2026-03-10",
        sourceDate: "2026-03-10",
        title: "水族館デート",
        kind: "meetup",
        repeatYearly: false,
      },
    ]);
  });

  it("範囲外の一回きりの予定は返らない", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2026-03-10", kind: "plan" });

    const result = await call(
      router.event.list,
      { from: "2026-04-01", to: "2026-04-30" },
      { context: contextFor(user) },
    );

    expect(result.items).toHaveLength(0);
  });

  it("他ペアのイベントは一覧に混ざらない", async () => {
    const userA = await createUser();
    await createCouple(userA);
    await createEvent(userA, { date: "2026-03-10", title: "Aの予定" });

    const userB = await createUser();
    await createCouple(userB);
    await createEvent(userB, { date: "2026-03-10", title: "Bの予定" });

    const result = await call(
      router.event.list,
      { from: "2026-03-01", to: "2026-03-31" },
      { context: contextFor(userA) },
    );

    expect(result.items.map((e) => e.title)).toEqual(["Aの予定"]);
  });
});

describe("event.update / event.delete", () => {
  it("自分のペアのイベントを更新できる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createEvent(user, { date: "2026-03-10", title: "元のタイトル" });

    const updated = await call(
      router.event.update,
      { id: created.id, date: "2026-03-11", title: "変更後のタイトル", kind: "meetup", repeatYearly: false },
      { context: contextFor(user) },
    );

    expect(updated).toEqual({
      id: created.id,
      date: "2026-03-11",
      sourceDate: "2026-03-11",
      title: "変更後のタイトル",
      kind: "meetup",
      repeatYearly: false,
    });
  });

  it("他ペアのイベントIDを指定した更新は NOT_FOUND になり、対象は変わらない", async () => {
    const userA = await createUser();
    await createCouple(userA);
    const eventA = await createEvent(userA, { title: "Aの予定" });

    const userB = await createUser();
    await createCouple(userB);

    await expect(
      call(
        router.event.update,
        { id: eventA.id, date: "2099-01-01", title: "改ざん", kind: "plan", repeatYearly: false },
        { context: contextFor(userB) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT title FROM events WHERE id = ?1").bind(eventA.id).first<{ title: string }>();
    expect(row?.title).toBe("Aの予定");
  });

  it("存在しないIDの更新は NOT_FOUND", async () => {
    const user = await createUser();
    await createCouple(user);
    await expect(
      call(
        router.event.update,
        { id: crypto.randomUUID(), date: "2026-01-01", title: "存在しない", kind: "plan", repeatYearly: false },
        { context: contextFor(user) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("自分のペアのイベントを削除できる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createEvent(user);

    const result = await call(router.event.delete, { id: created.id }, { context: contextFor(user) });
    expect(result.id).toBe(created.id);

    const row = await db.prepare("SELECT id FROM events WHERE id = ?1").bind(created.id).first();
    expect(row).toBeNull();
  });

  it("他ペアのイベントIDを指定した削除は NOT_FOUND になり、対象は消えない", async () => {
    const userA = await createUser();
    await createCouple(userA);
    const eventA = await createEvent(userA);

    const userB = await createUser();
    await createCouple(userB);

    await expect(
      call(router.event.delete, { id: eventA.id }, { context: contextFor(userB) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT id FROM events WHERE id = ?1").bind(eventA.id).first();
    expect(row).not.toBeNull();
  });
});

// architecture.md 5節「繰り返し記念日の射影」。完了条件・タスクファイルの
// 「テストで証明すること」に列挙された観点をそれぞれ1テストずつ対応させる
describe("event.list の繰り返し記念日の射影", () => {
  it("repeat_yearly の記念日が、登録年と異なる年の照会で正しく返る", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2020-05-10", title: "記念日", kind: "anniversary", repeatYearly: true });

    const result = await call(
      router.event.list,
      { from: "2026-05-01", to: "2026-05-31" },
      { context: contextFor(user) },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.date).toBe("2026-05-10");
    expect(result.items[0]?.sourceDate).toBe("2020-05-10");
    expect(result.items[0]?.repeatYearly).toBe(true);
  });

  it("範囲が年をまたぐとき、年末側と年始側の記念日が両方返る", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2020-12-25", title: "年末の記念日", kind: "anniversary", repeatYearly: true });
    await createEvent(user, { date: "2020-01-05", title: "年始の記念日", kind: "anniversary", repeatYearly: true });

    const result = await call(
      router.event.list,
      { from: "2026-12-20", to: "2027-01-10" },
      { context: contextFor(user) },
    );

    expect(result.items.map((e) => e.date).sort()).toEqual(["2026-12-25", "2027-01-05"]);
  });

  it("400日の範囲では同じ記念日が2回返る（重複を除去しない）", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2020-01-15", title: "1月15日の記念日", kind: "anniversary", repeatYearly: true });

    // 2026-01-01 〜 2027-02-05 はちょうど400日（architecture.md 5節の実例）
    const result = await call(
      router.event.list,
      { from: "2026-01-01", to: "2027-02-05" },
      { context: contextFor(user) },
    );

    const matches = result.items.filter((e) => e.title === "1月15日の記念日");
    expect(matches.map((e) => e.date).sort()).toEqual(["2026-01-15", "2027-01-15"]);
  });

  it("3つの暦年に触れる窓では、中間の年の記念日だけが返る（端の年は窓の外）", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2010-06-15", title: "6月15日の記念日", kind: "anniversary", repeatYearly: true });

    // 2026-12-20 〜 2028-01-24 はちょうど400日で2026・2027・2028の3年に触れる
    // （architecture.md 5節の実例）。06-15 は 2027-06-15 だけが窓に入る
    const result = await call(
      router.event.list,
      { from: "2026-12-20", to: "2028-01-24" },
      { context: contextFor(user) },
    );

    const matches = result.items.filter((e) => e.title === "6月15日の記念日");
    expect(matches.map((e) => e.date)).toEqual(["2027-06-15"]);
  });

  it("401日の範囲は INVALID_INPUT", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.event.list, { from: "2026-01-01", to: "2027-02-06" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("from が to より後だと INVALID_INPUT", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.event.list, { from: "2026-02-01", to: "2026-01-01" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("うるう年 02-29 の記念日は、平年に射影すると 02-28 に出る（消えない）", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2024-02-29", title: "うるう日の記念日", kind: "anniversary", repeatYearly: true });

    const result = await call(
      router.event.list,
      { from: "2026-02-01", to: "2026-02-28" },
      { context: contextFor(user) },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.date).toBe("2026-02-28");
    expect(result.items[0]?.sourceDate).toBe("2024-02-29");
  });

  it("うるう年へ射影したときは 02-29 のまま", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2024-02-29", title: "うるう日の記念日", kind: "anniversary", repeatYearly: true });

    const result = await call(
      router.event.list,
      { from: "2028-02-01", to: "2028-02-29" },
      { context: contextFor(user) },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.date).toBe("2028-02-29");
  });
});

import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { addDays, todayJst } from "@futary/date";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import { computeDaysTogether } from "../src/procedures/stats";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

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

function contextFor(user: { id: string; name: string; email: string } | null): RpcContext {
  return { db, bucket, r2Sign, user: user ? { ...user, image: null } : null, ip: "203.0.113.1", demoCoupleId: null };
}

// 023: couple.createは日付を受け取らないため、作成後にcouple.updateでdatingDateを
// 設定する（テストがペアを日付で区別できるよう、旧来どおり引数で指定させる）
async function createCouple(user: { id: string; name: string; email: string }, datingDate: string) {
  await call(router.couple.create, {}, { context: contextFor(user) });
  return call(
    router.couple.update,
    { datingDate, marriedDate: null, primaryDate: "dating" },
    { context: contextFor(user) },
  );
}

async function joinCouple(coupleId: string, user: { id: string; name: string; email: string }, slot: number) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(coupleId, user.id, slot, now)
    .run();
}

async function insertEvent(coupleId: string, createdBy: string, kind: string, date: string) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO events (id, couple_id, date, title, kind, repeat_yearly, created_by, created_at)
       VALUES (?1, ?2, ?3, '予定', ?4, 0, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), coupleId, date, kind, createdBy, now)
    .run();
}

async function insertPost(
  coupleId: string,
  authorId: string,
  options: { imageKey?: string; deleted?: boolean } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const deletedAt = options.deleted ? now : null;
  await db
    .prepare(
      `INSERT INTO posts (id, couple_id, author_id, body, image_key, created_at, deleted_at)
       VALUES (?1, ?2, ?3, '投稿', ?4, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), coupleId, authorId, options.imageKey ?? null, now, deletedAt)
    .run();
}

function couple(
  overrides: Partial<{ datingDate: string | null; marriedDate: string | null; primaryDate: string }> = {},
) {
  return {
    dating_date: overrides.datingDate === undefined ? "2026-01-01" : overrides.datingDate,
    married_date: overrides.marriedDate ?? null,
    primary_date: overrides.primaryDate ?? "dating",
  };
}

// 判別可能なunion（{status:"dating"} | {status:"dating_upcoming"} |
// {status:"married"} | {status:"married_upcoming"} | {status:"hidden"} |
// {status:"unset"}）の境界。「dating」の下端（今日→1日目）と
// 「dating_upcoming」の下端（明日→あと1日。0日にならない）の両方を押さえる
// （Rレビュー指摘: 片側だけだとoff-by-oneを見逃す）。019でprimary_dateの
// 分岐を追加した。dating/marriedそれぞれにupcomingの対を持たせる形に改名
// した（Aの決定・PR #123。旧together→dating、旧upcoming→dating_upcoming）。
// 023でunset（primary_dateが指している方の日付がまだ無い）を追加した
describe("computeDaysTogether", () => {
  it("primary_date='dating'・記念日が今日なら1日目", () => {
    expect(computeDaysTogether(couple({ datingDate: "2026-01-01" }), "2026-01-01")).toEqual({
      status: "dating",
      days: 1,
    });
  });

  it("primary_date='dating'・記念日が昨日なら2日目", () => {
    expect(computeDaysTogether(couple({ datingDate: "2025-12-31" }), "2026-01-01")).toEqual({
      status: "dating",
      days: 2,
    });
  });

  it("primary_date='dating'・記念日が明日なら「あと1日」（0日にならない）", () => {
    expect(computeDaysTogether(couple({ datingDate: "2026-01-02" }), "2026-01-01")).toEqual({
      status: "dating_upcoming",
      days: 1,
    });
  });

  it("primary_date='dating'・記念日が2日後なら「あと2日」", () => {
    expect(computeDaysTogether(couple({ datingDate: "2026-01-03" }), "2026-01-01")).toEqual({
      status: "dating_upcoming",
      days: 2,
    });
  });

  it("primary_date='dating'・年をまたいでも正しい", () => {
    expect(computeDaysTogether(couple({ datingDate: "2025-12-31" }), "2026-01-02")).toEqual({
      status: "dating",
      days: 3,
    });
  });

  it("primary_date='married'・結婚した日が今日なら1日目", () => {
    expect(
      computeDaysTogether(couple({ primaryDate: "married", marriedDate: "2026-01-01" }), "2026-01-01"),
    ).toEqual({ status: "married", days: 1 });
  });

  it("primary_date='married'・結婚した日が昨日なら2日目", () => {
    expect(
      computeDaysTogether(couple({ primaryDate: "married", marriedDate: "2025-12-31" }), "2026-01-01"),
    ).toEqual({ status: "married", days: 2 });
  });

  it("primary_date='married'・結婚した日が明日なら「結婚まであと1日」（married_upcoming。0日にならない）", () => {
    expect(
      computeDaysTogether(couple({ primaryDate: "married", marriedDate: "2026-01-02" }), "2026-01-01"),
    ).toEqual({ status: "married_upcoming", days: 1 });
  });

  it("primary_date='married'・結婚した日が2日後なら「結婚まであと2日」", () => {
    expect(
      computeDaysTogether(couple({ primaryDate: "married", marriedDate: "2026-01-03" }), "2026-01-01"),
    ).toEqual({ status: "married_upcoming", days: 2 });
  });

  it("primary_date='none'ならhidden（daysを含まない）", () => {
    const result = computeDaysTogether(couple({ primaryDate: "none" }), "2026-01-01");
    expect(result).toEqual({ status: "hidden" });
    expect(result).not.toHaveProperty("days");
  });

  // 023: 「まだ決めていない」はhiddenと違う（本人が隠すと決めたわけではない）
  it("primary_date='dating'・dating_dateが無いならunset（daysを含まない）", () => {
    const result = computeDaysTogether(couple({ primaryDate: "dating", datingDate: null }), "2026-01-01");
    expect(result).toEqual({ status: "unset" });
    expect(result).not.toHaveProperty("days");
  });

  it("primary_date='married'・married_dateが無いならunset（daysを含まない）", () => {
    const result = computeDaysTogether(couple({ primaryDate: "married", marriedDate: null }), "2026-01-01");
    expect(result).toEqual({ status: "unset" });
    expect(result).not.toHaveProperty("days");
  });

  // 「片方の日付があるから、そっちを出す」はしない。primary_date='married'なのに
  // dating_dateだけがあってもunsetのまま（利用者が選んだ方だけを見る）
  it("primary_date='married'・married_dateが無ければ、dating_dateがあってもunset", () => {
    const result = computeDaysTogether(
      couple({ primaryDate: "married", datingDate: "2020-01-01", marriedDate: null }),
      "2026-01-01",
    );
    expect(result).toEqual({ status: "unset" });
  });
});

describe("stats.get", () => {
  it("記念日が今日のペアはdaysTogetherが1日目", async () => {
    const user = await createUser();
    await createCouple(user, todayJst());

    const stats = await call(router.stats.get, undefined, { context: contextFor(user) });

    expect(stats.daysTogether).toEqual({ status: "dating", days: 1 });
  });

  // L66（Aの決定）: datingDateSchemaの上限緩和（1年後まで）によりupcomingへ
  // 実際に到達できることを、入力から出力まで通しで確認する
  it("記念日が未来（1ヶ月後）のペアはdaysTogetherがdating_upcoming・daysが正の値になる", async () => {
    const user = await createUser();
    const nearFuture = addDays(todayJst(), 30);
    await createCouple(user, nearFuture);

    const stats = await call(router.stats.get, undefined, { context: contextFor(user) });

    expect(stats.daysTogether).toEqual({ status: "dating_upcoming", days: 30 });
  });

  // 023: couple.create直後（付き合った日を登録時に聞かなくなった）はdatingDateが
  // nullのまま。stats.getはこれをunsetとして返す（この要望の本体）
  it("couple.create直後（付き合った日を設定していない）はdaysTogetherがunset", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    const stats = await call(router.stats.get, undefined, { context: contextFor(user) });

    expect(stats.daysTogether).toEqual({ status: "unset" });
  });

  // 019: couple.updateでprimary_dateを変えると、stats.getのdaysTogetherに反映される
  it("primaryDate='married'に変えると、daysTogetherがmarriedになる", async () => {
    const user = await createUser();
    await createCouple(user, "2020-01-01");
    await call(
      router.couple.update,
      { datingDate: "2020-01-01", marriedDate: todayJst(), primaryDate: "married" },
      { context: contextFor(user) },
    );

    const stats = await call(router.stats.get, undefined, { context: contextFor(user) });

    expect(stats.daysTogether).toEqual({ status: "married", days: 1 });
  });

  it("primaryDate='none'に変えると、daysTogetherがhiddenになりdaysを含まない", async () => {
    const user = await createUser();
    await createCouple(user, "2020-01-01");
    await call(
      router.couple.update,
      { datingDate: "2020-01-01", marriedDate: null, primaryDate: "none" },
      { context: contextFor(user) },
    );

    const stats = await call(router.stats.get, undefined, { context: contextFor(user) });

    expect(stats.daysTogether).toEqual({ status: "hidden" });
    expect(stats.daysTogether).not.toHaveProperty("days");
  });

  // 023: datingDateがnullのままでもmeetupDays/postCount/photoCountは出る
  // （消すのは記念日の行だけ。020で決めた「hiddenのときも会った日数は残す」と
  // 同じ扱いをunsetにも及ぼす）
  it("datingDateが無くてもmeetupDays・postCount・photoCountは返る", async () => {
    const user = await createUser();
    const created = await call(router.couple.create, {}, { context: contextFor(user) });
    await insertEvent(created.id, user.id, "meetup", todayJst());
    await insertPost(created.id, user.id, { imageKey: "img-unset-1" });

    const stats = await call(router.stats.get, undefined, { context: contextFor(user) });

    expect(stats.daysTogether).toEqual({ status: "unset" });
    expect(stats.meetupDays).toBe(1);
    expect(stats.postCount).toBe(1);
    expect(stats.photoCount).toBe(1);
  });

  it("会った日ゼロならmeetupDaysは0（カード自体は出る＝エラーにならない）", async () => {
    const user = await createUser();
    await createCouple(user, todayJst());

    const stats = await call(router.stats.get, undefined, { context: contextFor(user) });

    expect(stats.meetupDays).toBe(0);
  });

  it("meetupDaysはkind='meetup'の件数のみを数える（plan/anniversaryは含めない）", async () => {
    const user = await createUser();
    const couple = await createCouple(user, todayJst());
    await insertEvent(couple.id, user.id, "meetup", todayJst());
    await insertEvent(couple.id, user.id, "meetup", addDays(todayJst(), -1));
    await insertEvent(couple.id, user.id, "plan", todayJst());
    await insertEvent(couple.id, user.id, "anniversary", todayJst());

    const stats = await call(router.stats.get, undefined, { context: contextFor(user) });

    expect(stats.meetupDays).toBe(2);
  });

  it("postCountは未削除の投稿のみを数える", async () => {
    const user = await createUser();
    const couple = await createCouple(user, todayJst());
    await insertPost(couple.id, user.id);
    await insertPost(couple.id, user.id, { deleted: true });

    const stats = await call(router.stats.get, undefined, { context: contextFor(user) });

    expect(stats.postCount).toBe(1);
  });

  // L65（Rの先読み指摘）: 削除済みでもimage_keyは残る（007の決定）ため、
  // deleted_at IS NULLを条件に含めないとphotoCountがpostCountを上回ってしまう
  it("photoCountは未削除・画像ありの投稿のみを数える（削除済みの写真投稿は含めない）", async () => {
    const user = await createUser();
    const couple = await createCouple(user, todayJst());
    await insertPost(couple.id, user.id, { imageKey: "img-1" });
    await insertPost(couple.id, user.id, { imageKey: "img-2", deleted: true });
    await insertPost(couple.id, user.id); // 画像なし

    const stats = await call(router.stats.get, undefined, { context: contextFor(user) });

    expect(stats.postCount).toBe(2); // 未削除は2件（画像あり1・画像なし1）
    expect(stats.photoCount).toBe(1); // うち画像ありの未削除は1件のみ
    expect(stats.photoCount).toBeLessThanOrEqual(stats.postCount);
  });

  it("ペアが1人だけならmembersは1件（招待中の判定に使う）", async () => {
    const user = await createUser();
    await createCouple(user, todayJst());

    const stats = await call(router.stats.get, undefined, { context: contextFor(user) });

    expect(stats.members).toHaveLength(1);
    expect(stats.members[0]?.userId).toBe(user.id);
  });

  it("2人揃っているとmembersは2件、slot昇順で返る", async () => {
    const user1 = await createUser();
    const couple = await createCouple(user1, todayJst());
    const user2 = await createUser();
    await joinCouple(couple.id, user2, 2);

    const stats = await call(router.stats.get, undefined, { context: contextFor(user1) });

    expect(stats.members).toHaveLength(2);
    expect(stats.members.map((m) => m.userId)).toEqual([user1.id, user2.id]);
  });
});

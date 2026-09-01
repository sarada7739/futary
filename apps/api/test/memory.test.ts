import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { addDays, jstDayRangeMs, monthsBefore, todayJst, yearsBefore } from "@futary/date";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import { stableHash } from "../src/procedures/memory";
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
  return {
    db,
    bucket,
    r2Sign,
    user: user ? { ...user, image: null } : null,
    ip: "203.0.113.1",
    demoCoupleId: null,
    sessionCreatedAt: user ? Date.now() : null,
    authSecret: "test-secret",
  };
}

async function createCouple(user: { id: string; name: string; email: string }) {
  return call(router.couple.create, {}, { context: contextFor(user) });
}

// JSTのdate（YYYY-MM-DD）内の固定時刻（正午）に対応するUnix秒を返す。
// 日境界の前後でテストが揺れないよう、日の真ん中を使う
function secondsAt(date: string): number {
  return Math.floor(jstDayRangeMs(date).fromMs / 1000) + 12 * 60 * 60;
}

async function insertPost(
  coupleId: string,
  authorId: string,
  date: string,
  options: { body?: string; imageKey?: string; deleted?: boolean } = {},
) {
  const createdAt = secondsAt(date);
  const deletedAt = options.deleted ? createdAt + 1 : null;
  await db
    .prepare(
      `INSERT INTO posts (id, couple_id, author_id, body, image_key, created_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(crypto.randomUUID(), coupleId, authorId, options.body ?? "思い出の投稿", options.imageKey ?? null, createdAt, deletedAt)
    .run();
}

describe("memory.get", () => {
  it("1ヶ月前に投稿があれば、それが返りラベルはoneMonthAgo", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const oneMonthAgo = monthsBefore(todayJst(), 1);
    await insertPost(couple.id, user.id, oneMonthAgo, { body: "1ヶ月前の投稿" });

    const result = await call(router.memory.get, undefined, { context: contextFor(user) });

    expect(result?.label).toBe("oneMonthAgo");
    expect(result?.post.body).toBe("1ヶ月前の投稿");
  });

  it("1ヶ月前・半年前が無く1年前にあれば、1年前が返る", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const oneYearAgo = yearsBefore(todayJst(), 1);
    await insertPost(couple.id, user.id, oneYearAgo, { body: "1年前の投稿" });

    const result = await call(router.memory.get, undefined, { context: contextFor(user) });

    expect(result?.label).toBe("oneYearAgo");
    expect(result?.post.body).toBe("1年前の投稿");
  });

  it("どの節目にも無いが7日以上前の投稿があれば、ランダムに1件返る", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    await insertPost(couple.id, user.id, addDays(todayJst(), -30), { body: "古い投稿" });

    const result = await call(router.memory.get, undefined, { context: contextFor(user) });

    expect(result?.label).toBe("random");
    expect(result?.post.body).toBe("古い投稿");
  });

  it("投稿が7日分（6日前まで）しかなければnull", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    await insertPost(couple.id, user.id, addDays(todayJst(), -6));

    const result = await call(router.memory.get, undefined, { context: contextFor(user) });

    expect(result).toBeNull();
  });

  it("投稿ゼロならnull", async () => {
    const user = await createUser();
    await createCouple(user);

    const result = await call(router.memory.get, undefined, { context: contextFor(user) });

    expect(result).toBeNull();
  });

  // 7日境界を両側で押さえる（Rレビュー指摘: 片側だけだと見逃す）
  it("ちょうど7日前の投稿1件だけがある状態ではrandomで返る（境界の内側）", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    await insertPost(couple.id, user.id, addDays(todayJst(), -7), { body: "7日前ぴったり" });

    const result = await call(router.memory.get, undefined, { context: contextFor(user) });

    expect(result?.label).toBe("random");
    expect(result?.post.body).toBe("7日前ぴったり");
  });

  it("6日前の投稿1件だけならnull（境界の外側）", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    await insertPost(couple.id, user.id, addDays(todayJst(), -6), { body: "6日前" });

    const result = await call(router.memory.get, undefined, { context: contextFor(user) });

    expect(result).toBeNull();
  });

  // L61「存在しない日付は月末に寄せる」の境界（3/29・30・31の1ヶ月前が
  // 3日とも2/28になる等）はpackages/date/test/date.test.tsのmonthsBeforeの
  // テストで網羅済み。memory.tsはmonthsBefore/yearsBeforeを独自再実装せず
  // そのままimportして使っている（本ファイル冒頭のimportを参照）ため、
  // ここで別途「今日を3/31に固定して」再検証はしない（procedureはtodayJst()を
  // 引数なしで呼ぶ設計のため、テストからは差し替えられない。他のprocedureの
  // テストも同様に実時刻を基準に組み立てている）。上の「1ヶ月前に投稿があれば
  // oneMonthAgoが返る」テストは、実行時点の実際の「今日」に対する1ヶ月前
  // （どんな月末クランプが起きるかを問わず）でmonthsBeforeの結果と
  // memory.getの探索が一致することを既に確認している

  // L69: 削除済みの投稿は復活しない
  it("1ヶ月前の投稿が削除済みなら、そこは無かったものとして次の節目を探す", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const oneMonthAgo = monthsBefore(todayJst(), 1);
    const oneYearAgo = yearsBefore(todayJst(), 1);
    await insertPost(couple.id, user.id, oneMonthAgo, { body: "削除済み", deleted: true });
    await insertPost(couple.id, user.id, oneYearAgo, { body: "1年前は生きている" });

    const result = await call(router.memory.get, undefined, { context: contextFor(user) });

    expect(result?.label).toBe("oneYearAgo");
    expect(result?.post.body).toBe("1年前は生きている");
  });

  it("削除済みの投稿しか無ければnull（ランダム候補にも入らない）", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    await insertPost(couple.id, user.id, addDays(todayJst(), -30), { deleted: true });

    const result = await call(router.memory.get, undefined, { context: contextFor(user) });

    expect(result).toBeNull();
  });

  it("同じ日に何度呼んでも同じ投稿が返る（決定的な選択）", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    await insertPost(couple.id, user.id, addDays(todayJst(), -30), { body: "候補A" });
    await insertPost(couple.id, user.id, addDays(todayJst(), -60), { body: "候補B" });
    await insertPost(couple.id, user.id, addDays(todayJst(), -90), { body: "候補C" });

    const first = await call(router.memory.get, undefined, { context: contextFor(user) });
    const second = await call(router.memory.get, undefined, { context: contextFor(user) });

    expect(first?.post.id).toBe(second?.post.id);
  });

  it("画像がある投稿は署名付きURLが発行される", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    await insertPost(couple.id, user.id, addDays(todayJst(), -30), { imageKey: "couples/x/posts/img.jpg" });

    const result = await call(router.memory.get, undefined, { context: contextFor(user) });

    expect(result?.post.imageUrl).not.toBeNull();
  });

  it("他ペアの投稿は混ざらない", async () => {
    const userA = await createUser();
    const coupleA = await createCouple(userA);
    await insertPost(coupleA.id, userA.id, addDays(todayJst(), -30), { body: "Aの思い出" });

    const userB = await createUser();
    await createCouple(userB);

    const resultB = await call(router.memory.get, undefined, { context: contextFor(userB) });

    expect(resultB).toBeNull();
  });
});

// stableHashを直接テストする。「procedure（memory.get）はtodayJst()を引数なしで
// 呼ぶため、テストから『日付が変わったら結果も変わりうる』を統合テストレベルでは
// 検証できない（他のprocedureのテストも同様の制約を持つ）。この性質は
// 選択ロジックの核であるstableHashに閉じているため、ここで直接検証する
describe("stableHash（memory.getのランダム選択が決定的であることの根拠）", () => {
  it("同じ入力なら常に同じ値を返す（決定的）", () => {
    const input = "couple-1:2026-06-15";
    expect(stableHash(input)).toBe(stableHash(input));
  });

  it("日付が変われば値も変わりうる", () => {
    const values = new Set(
      Array.from({ length: 10 }, (_, i) => stableHash(`couple-1:2026-06-${String(15 + i).padStart(2, "0")}`)),
    );
    // 10件全部が同じ値に潰れることはない（決定的だが定数関数ではない）
    expect(values.size).toBeGreaterThan(1);
  });

  it("ペアが変われば同じ日付でも値が変わりうる", () => {
    expect(stableHash("couple-1:2026-06-15")).not.toBe(stableHash("couple-2:2026-06-15"));
  });
});

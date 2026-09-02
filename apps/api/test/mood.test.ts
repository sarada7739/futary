import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { todayJst } from "@futary/date";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

// wish.test.tsと同じ理由（実際のR2 APIトークンの設定有無にテストの合否を左右させない）
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
  await db.batch([
    db
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
      )
      .bind(id, name, email, now),
    // invite.acceptがaccount_id（Googleの識別子）を引く（024）
    db
      .prepare(
        "INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at) VALUES (?1, 'google', ?2, 'google', ?3, ?4, ?4)",
      )
      .bind(crypto.randomUUID(), `google-sub-${id}`, id, now),
  ]);
  return { id, name, email };
}

function contextFor(
  user: { id: string; name: string; email: string } | null,
  demoCoupleId: string | null = null,
): RpcContext {
  return {
    db,
    bucket,
    r2Sign,
    user: user ? { ...user, image: null } : null,
    ip: "203.0.113.1",
    demoCoupleId,
    sessionCreatedAt: user ? Date.now() : null,
    authSecret: "test-secret",
  };
}

async function createCouple(user: { id: string; name: string; email: string }) {
  return call(router.couple.create, {}, { context: contextFor(user) });
}

async function createCoupleOfTwo() {
  const owner = await createUser();
  await createCouple(owner);
  const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
  const partner = await createUser();
  await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
  return { owner, partner };
}

const TODAY = todayJst();

describe("mood.setToday / mood.list", () => {
  it("今日の分を記録すると、自分の一覧にだけ出る", async () => {
    const { owner, partner } = await createCoupleOfTwo();

    const set = await call(router.mood.setToday, { level: 4 }, { context: contextFor(owner) });
    expect(set).toEqual({ date: TODAY, level: 4 });

    const list = await call(
      router.mood.list,
      { from: TODAY, to: TODAY },
      { context: contextFor(owner) },
    );
    expect(list.mine).toEqual([{ date: TODAY, level: 4 }]);
    expect(list.partner).toEqual({ name: partner.name, items: [] });
  });

  // タスク定義6節「渡せないものは、間違えて渡せない」: user_idを引数に
  // 取らないため、自分の分しか書けない
  it("相手が記録しても自分のmineには出ず、相手のpartner.itemsに出る", async () => {
    const { owner, partner } = await createCoupleOfTwo();

    await call(router.mood.setToday, { level: 2 }, { context: contextFor(partner) });

    const list = await call(
      router.mood.list,
      { from: TODAY, to: TODAY },
      { context: contextFor(owner) },
    );
    expect(list.mine).toEqual([]);
    expect(list.partner).toEqual({ name: partner.name, items: [{ date: TODAY, level: 2 }] });
  });

  // 複合主キー（couple_id, user_id, date）へのON CONFLICT DO UPDATEで
  // upsertする。同じ日に2回呼んでも行が増えない
  it("同じ日に2回setTodayを呼ぶと、行が増えずに上書きされる", async () => {
    const { owner } = await createCoupleOfTwo();

    await call(router.mood.setToday, { level: 1 }, { context: contextFor(owner) });
    const second = await call(router.mood.setToday, { level: 5 }, { context: contextFor(owner) });
    expect(second).toEqual({ date: TODAY, level: 5 });

    const { results } = await db
      .prepare("SELECT level AS level FROM moods WHERE user_id = ?1 AND date = ?2")
      .bind(owner.id, TODAY)
      .all<{ level: number }>();
    expect(results).toHaveLength(1);
    expect(results[0]?.level).toBe(5);
  });

  // levelの範囲（1〜5）は入力だけで判定できるためZodで弾く（BAD_REQUEST。
  // conventions.md 5節）。DB側の名前付きCHECK（moods_level_range_check）も
  // schema-integrity.test.tsで別途固定する
  it.each([0, 6, -1, 1.5])("levelが%sだとBAD_REQUEST", async (level) => {
    const { owner } = await createCoupleOfTwo();

    await expect(
      call(router.mood.setToday, { level }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("moods_level_range_check はDB側にも効いている（procedureを迂回した直接INSERTで確認）", async () => {
    const { owner } = await createCoupleOfTwo();
    const couple = await call(router.couple.get, undefined, { context: contextFor(owner) });
    const now = Math.floor(Date.now() / 1000);

    await expect(
      db
        .prepare(
          "INSERT INTO moods (couple_id, user_id, date, level, created_at, updated_at) VALUES (?1, ?2, ?3, 9, ?4, ?4)",
        )
        .bind(couple.id, owner.id, TODAY, now)
        .run(),
    ).rejects.toThrow();
  });

  it("他ペアの記録は一覧に混ざらない", async () => {
    const { owner: ownerA } = await createCoupleOfTwo();
    const { owner: ownerB } = await createCoupleOfTwo();

    await call(router.mood.setToday, { level: 3 }, { context: contextFor(ownerA) });
    await call(router.mood.setToday, { level: 1 }, { context: contextFor(ownerB) });

    const list = await call(
      router.mood.list,
      { from: TODAY, to: TODAY },
      { context: contextFor(ownerA) },
    );
    expect(list.mine).toEqual([{ date: TODAY, level: 3 }]);
  });

  // タスク定義11節: 相手が未参加（ペアが1人）ならpartnerはnull
  it("相手が未参加のペアではpartnerがnull", async () => {
    const owner = await createUser();
    await createCouple(owner);
    await call(router.mood.setToday, { level: 3 }, { context: contextFor(owner) });

    const list = await call(
      router.mood.list,
      { from: TODAY, to: TODAY },
      { context: contextFor(owner) },
    );
    expect(list.partner).toBeNull();
  });

  // event.listと同じ数に揃える（conventions.md 5節「線に合っていないもの」）
  it("400日の範囲は通り、401日の範囲はINVALID_INPUT", async () => {
    const { owner } = await createCoupleOfTwo();

    await expect(
      call(router.mood.list, { from: "2026-01-01", to: "2027-02-05" }, { context: contextFor(owner) }),
    ).resolves.toBeDefined();

    await expect(
      call(router.mood.list, { from: "2026-01-01", to: "2027-02-06" }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("fromがtoより後だとINVALID_INPUT", async () => {
    const { owner } = await createCoupleOfTwo();

    await expect(
      call(router.mood.list, { from: "2026-02-01", to: "2026-01-01" }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("mood.clearToday", () => {
  it("今日の分を消せる（物理削除）", async () => {
    const { owner } = await createCoupleOfTwo();
    await call(router.mood.setToday, { level: 4 }, { context: contextFor(owner) });

    const cleared = await call(router.mood.clearToday, undefined, { context: contextFor(owner) });
    expect(cleared).toEqual({ date: TODAY });

    const row = await db
      .prepare("SELECT 1 FROM moods WHERE user_id = ?1 AND date = ?2")
      .bind(owner.id, TODAY)
      .first();
    expect(row).toBeNull();

    const list = await call(
      router.mood.list,
      { from: TODAY, to: TODAY },
      { context: contextFor(owner) },
    );
    expect(list.mine).toEqual([]);
  });

  // 消す対象が無いだけで、エラーにする理由が無い（冪等）
  it("記録が無い日にclearTodayを呼んでもエラーにならない", async () => {
    const { owner } = await createCoupleOfTwo();

    const cleared = await call(router.mood.clearToday, undefined, { context: contextFor(owner) });
    expect(cleared).toEqual({ date: TODAY });
  });

  it("相手の記録には影響しない", async () => {
    const { owner, partner } = await createCoupleOfTwo();
    await call(router.mood.setToday, { level: 2 }, { context: contextFor(owner) });
    await call(router.mood.setToday, { level: 5 }, { context: contextFor(partner) });

    await call(router.mood.clearToday, undefined, { context: contextFor(owner) });

    const list = await call(
      router.mood.list,
      { from: TODAY, to: TODAY },
      { context: contextFor(partner) },
    );
    expect(list.mine).toEqual([{ date: TODAY, level: 5 }]);
  });
});

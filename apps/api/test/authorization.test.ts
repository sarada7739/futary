import { env } from "cloudflare:test";
import { call, isProcedure } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import { authedProcedure, readProcedure, writeProcedure } from "../src/procedures/base";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

// docs/tasks/005-authorization-middleware.md / security-requirements.md 3節の
// 「認可を触った全てのタスクで維持される」5項目。今後 post/reaction/event 等が
// readProcedure/writeProcedure に載るたびに、このファイルの構造を踏襲して
// 5項目を確認する

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

// post.test.ts と同じ理由（実際の R2 API トークンの設定有無に依存させない）
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
    // invite.acceptがaccount_id（Googleの識別子）を引く（024）。このファイルは
    // ペア成立にinvite.acceptを使うため、account行が無いと失敗する
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

// 023: couple.createは日付を受け取らないため、作成後にcouple.updateで
// datingDateを設定する（テストがペアを日付で区別できるよう、旧来どおり
// 引数で指定させる）
async function createCouple(
  user: { id: string; name: string; email: string },
  datingDate = "2020-01-01",
) {
  await call(router.couple.create, {}, { context: contextFor(user) });
  return call(
    router.couple.update,
    { datingDate, marriedDate: null, primaryDate: "dating" },
    { context: contextFor(user) },
  );
}

// couple.get が SELECT できるよう、is_demo=1 の couples 行を直接作る
// （デモペアを作る 014 はまだ実装されていないため、テストのセットアップとして用意する）
async function createDemoCouple(): Promise<string> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("INSERT INTO couples (id, dating_date, is_demo, created_at) VALUES (?1, '2019-01-01', 1, ?2)")
    .bind(id, now)
    .run();
  return id;
}

describe("1. ペアAのユーザーがペアBのレコードを取得・更新できない", () => {
  it("手続きの入力に coupleId が無いため、couple.get は常に自分の所属ペアだけを返す", async () => {
    const userA = await createUser();
    const coupleA = await createCouple(userA, "2020-01-01");
    const userB = await createUser();
    await createCouple(userB, "2021-01-01");

    const fetched = await call(router.couple.get, undefined, { context: contextFor(userA) });

    expect(fetched.id).toBe(coupleA.id);
    expect(fetched.datingDate).toBe("2020-01-01");
  });

  it("couple.update は自分の所属ペアしか変更できず、他ペアのレコードは変わらない", async () => {
    const userA = await createUser();
    await createCouple(userA, "2020-01-01");
    const userB = await createUser();
    const coupleB = await createCouple(userB, "2021-01-01");

    await call(
      router.couple.update,
      { datingDate: "2022-02-02", marriedDate: null, primaryDate: "dating" },
      { context: contextFor(userA) },
    );

    const bAfter = await call(router.couple.get, undefined, { context: contextFor(userB) });
    expect(bAfter.datingDate).toBe(coupleB.datingDate);
    expect(bAfter.datingDate).not.toBe("2022-02-02");
  });

  // 006: post.list/post.delete も ctx.coupleId のみを使う（引数に coupleId を
  // 持たない）ため、他ペアのレコードには経路自体が存在しない
  it("post.list は自分の所属ペアの投稿だけを返し、post.delete は他ペアの投稿IDを指定しても消せない", async () => {
    const userA = await createUser();
    await createCouple(userA, "2020-01-01");
    const postA = await call(router.post.create, { body: "Aの投稿" }, { context: contextFor(userA) });
    const userB = await createUser();
    await createCouple(userB, "2021-01-01");
    const postB = await call(router.post.create, { body: "Bの投稿" }, { context: contextFor(userB) });

    const listA = await call(router.post.list, {}, { context: contextFor(userA) });
    expect(listA.items.map((p) => p.id)).toEqual([postA.id]);

    await expect(
      call(router.post.delete, { id: postB.id }, { context: contextFor(userA) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // 削除に失敗した Bの投稿は残っている
    const listB = await call(router.post.list, {}, { context: contextFor(userB) });
    expect(listB.items.map((p) => p.id)).toEqual([postB.id]);
  });
});

// 網羅性は人手のリスト更新に依存する（router を再帰走査して自動検出する仕組みは
// 005では見送った。security-auditor 005監査 Low指摘）。
// 新しい書き込み手続きを追加したら、ここと couple.test.ts/invite.test.ts 双方に
// 「未認証なら FORBIDDEN」のケースを追加すること
describe("2. 未認証アクセスで書き込み系の手続きが全て FORBIDDEN になる", () => {
  it("couple.update は DEMO_COUPLE_ID が設定されていても FORBIDDEN", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(
        router.couple.update,
        { datingDate: "2022-02-02", marriedDate: null, primaryDate: "dating" },
        { context: contextFor(null, demoCoupleId) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("invite.issue は DEMO_COUPLE_ID が設定されていても FORBIDDEN", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.invite.issue, undefined, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("post.create は DEMO_COUPLE_ID が設定されていても FORBIDDEN", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.post.create, { body: "デモから投稿" }, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("post.delete は DEMO_COUPLE_ID が設定されていても FORBIDDEN", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.post.delete, { id: crypto.randomUUID() }, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("post.uploadUrl は DEMO_COUPLE_ID が設定されていても FORBIDDEN（007）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.post.uploadUrl, { contentType: "image/jpeg" }, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reaction.toggle は DEMO_COUPLE_ID が設定されていても FORBIDDEN（009）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(
        router.reaction.toggle,
        { postId: crypto.randomUUID(), kind: "heart" },
        { context: contextFor(null, demoCoupleId) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("event.create は DEMO_COUPLE_ID が設定されていても FORBIDDEN（010）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(
        router.event.create,
        { date: "2026-01-01", title: "デモから登録", kind: "plan", repeatYearly: false, isShared: false },
        { context: contextFor(null, demoCoupleId) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("event.update は DEMO_COUPLE_ID が設定されていても FORBIDDEN（010）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(
        router.event.update,
        { id: crypto.randomUUID(), date: "2026-01-01", title: "デモから更新", kind: "plan", repeatYearly: false, isShared: false },
        { context: contextFor(null, demoCoupleId) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("event.delete は DEMO_COUPLE_ID が設定されていても FORBIDDEN（010）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.event.delete, { id: crypto.randomUUID() }, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("wish.create は DEMO_COUPLE_ID が設定されていても FORBIDDEN（027）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.wish.create, { title: "デモから登録" }, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("wish.setDone は DEMO_COUPLE_ID が設定されていても FORBIDDEN（027）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(
        router.wish.setDone,
        { id: crypto.randomUUID(), done: true },
        { context: contextFor(null, demoCoupleId) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("wish.update は DEMO_COUPLE_ID が設定されていても FORBIDDEN（028）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(
        router.wish.update,
        { id: crypto.randomUUID(), title: "デモから改題" },
        { context: contextFor(null, demoCoupleId) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("wish.delete は DEMO_COUPLE_ID が設定されていても FORBIDDEN（027）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.wish.delete, { id: crypto.randomUUID() }, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("mood.setToday は DEMO_COUPLE_ID が設定されていても FORBIDDEN（029）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.mood.setToday, { level: 3 }, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("mood.clearToday は DEMO_COUPLE_ID が設定されていても FORBIDDEN（029）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.mood.clearToday, undefined, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // me.update/me.uploadImageUrlはcouple_idを持たず authedProcedure の上に載る
  // （couple_idの有無に関わらず未認証を弾く。019）ため、DEMO_COUPLE_IDの
  // 設定有無を問わずFORBIDDENになることだけを確認する
  it("me.update は未認証なら FORBIDDEN（019）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.me.update, { name: "デモから変更" }, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("me.uploadImageUrl は未認証なら FORBIDDEN（019）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.me.uploadImageUrl, { contentType: "image/jpeg" }, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("me.delete は未認証なら FORBIDDEN（024）", async () => {
    const demoCoupleId = await createDemoCouple();

    await expect(
      call(router.me.delete, undefined, { context: contextFor(null, demoCoupleId) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("3. 未認証アクセスで読み取れるのがデモペアのデータのみである", () => {
  it("couple.get は DEMO_COUPLE_ID のペアを返す。他ペアのデータは混ざらない", async () => {
    const demoCoupleId = await createDemoCouple();
    const owner = await createUser();
    await createCouple(owner, "2020-01-01");

    const result = await call(router.couple.get, undefined, { context: contextFor(null, demoCoupleId) });

    expect(result.id).toBe(demoCoupleId);
    expect(result.datingDate).toBe("2019-01-01");
  });

  it("post.list は DEMO_COUPLE_ID のペアの投稿だけを返す。他ペアの投稿は混ざらない", async () => {
    const demoCoupleId = await createDemoCouple();
    const demoAuthor = await createUser();
    await db
      .prepare("INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(crypto.randomUUID(), demoCoupleId, demoAuthor.id, "デモの投稿", Math.floor(Date.now() / 1000))
      .run();

    const owner = await createUser();
    await createCouple(owner, "2020-01-01");
    await call(router.post.create, { body: "他ペアの投稿" }, { context: contextFor(owner) });

    const result = await call(router.post.list, {}, { context: contextFor(null, demoCoupleId) });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.body).toBe("デモの投稿");
    expect(result.items.map((p) => p.body)).not.toContain("他ペアの投稿");
  });

  it("stats.get は DEMO_COUPLE_ID のペアの統計だけを返す（012）", async () => {
    const demoCoupleId = await createDemoCouple();
    const owner = await createUser();
    await createCouple(owner, "2020-01-01");

    const result = await call(router.stats.get, undefined, { context: contextFor(null, demoCoupleId) });

    // createDemoCoupleはcouple_membersを作らない（メンバーゼロ）。owner側のペアが
    // 混ざっていれば members に owner.id を含む1件が返るはずで、それが無いことで
    // デモペア側のデータであることを確認する
    expect(result.members).toHaveLength(0);
  });

  it("memory.get は DEMO_COUPLE_ID のペアの投稿だけを返す。他ペアの投稿は混ざらない（013）", async () => {
    const demoCoupleId = await createDemoCouple();
    const demoAuthor = await createUser();
    const oldSeconds = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    await db
      .prepare("INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(crypto.randomUUID(), demoCoupleId, demoAuthor.id, "デモの思い出", oldSeconds)
      .run();

    const owner = await createUser();
    const ownerCouple = await createCouple(owner, "2020-01-01");
    await db
      .prepare("INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(crypto.randomUUID(), ownerCouple.id, owner.id, "他ペアの思い出", oldSeconds)
      .run();

    const result = await call(router.memory.get, undefined, { context: contextFor(null, demoCoupleId) });

    expect(result?.post.body).toBe("デモの思い出");
  });

  it("wish.list は DEMO_COUPLE_ID のペアの行だけを返す。他ペアの行は混ざらない（027）", async () => {
    const demoCoupleId = await createDemoCouple();
    const demoCreator = await createUser();
    await db
      .prepare("INSERT INTO wishes (id, couple_id, title, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(crypto.randomUUID(), demoCoupleId, "デモの行きたい場所", demoCreator.id, Math.floor(Date.now() / 1000))
      .run();

    const owner = await createUser();
    await createCouple(owner, "2020-01-01");
    await call(router.wish.create, { title: "他ペアの行きたい場所" }, { context: contextFor(owner) });

    const result = await call(router.wish.list, {}, { context: contextFor(null, demoCoupleId) });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("デモの行きたい場所");
    expect(result.items.map((w) => w.title)).not.toContain("他ペアの行きたい場所");
  });

  it("mood.list は DEMO_COUPLE_ID のペアの記録だけを返す。他ペアの記録は混ざらない（029）", async () => {
    const demoCoupleId = await createDemoCouple();
    const demoMember = await createUser();
    await db
      .prepare("INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES (?1, ?2, 1, ?3)")
      .bind(demoCoupleId, demoMember.id, Math.floor(Date.now() / 1000))
      .run();
    await db
      .prepare(
        "INSERT INTO moods (couple_id, user_id, date, level, created_at, updated_at) VALUES (?1, ?2, '2026-01-01', 4, ?3, ?3)",
      )
      .bind(demoCoupleId, demoMember.id, Math.floor(Date.now() / 1000))
      .run();

    const owner = await createUser();
    await createCouple(owner, "2020-01-01");
    await call(router.mood.setToday, { level: 1 }, { context: contextFor(owner) });

    const result = await call(
      router.mood.list,
      { from: "2025-12-01", to: "2026-01-31" },
      { context: contextFor(null, demoCoupleId) },
    );

    expect(result.mine).toEqual([{ date: "2026-01-01", level: 4 }]);
  });
});

describe("4. ペアに未所属のユーザーが呼ぶと NEEDS_ONBOARDING になる", () => {
  it("couple.get", async () => {
    const user = await createUser();
    await expect(call(router.couple.get, undefined, { context: contextFor(user) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  it("couple.update", async () => {
    const user = await createUser();
    await expect(
      call(
        router.couple.update,
        { datingDate: "2022-02-02", marriedDate: null, primaryDate: "dating" },
        { context: contextFor(user) },
      ),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("invite.issue", async () => {
    const user = await createUser();
    await expect(call(router.invite.issue, undefined, { context: contextFor(user) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  it("post.list", async () => {
    const user = await createUser();
    await expect(call(router.post.list, {}, { context: contextFor(user) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  it("post.create", async () => {
    const user = await createUser();
    await expect(
      call(router.post.create, { body: "こんにちは" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("post.delete", async () => {
    const user = await createUser();
    await expect(
      call(router.post.delete, { id: crypto.randomUUID() }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("post.uploadUrl（007）", async () => {
    const user = await createUser();
    await expect(
      call(router.post.uploadUrl, { contentType: "image/jpeg" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("reaction.toggle（009）", async () => {
    const user = await createUser();
    await expect(
      call(router.reaction.toggle, { postId: crypto.randomUUID(), kind: "heart" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("event.list（010）", async () => {
    const user = await createUser();
    await expect(
      call(router.event.list, { from: "2026-01-01", to: "2026-01-31" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("event.create（010）", async () => {
    const user = await createUser();
    await expect(
      call(
        router.event.create,
        { date: "2026-01-01", title: "予定", kind: "plan", repeatYearly: false, isShared: false },
        { context: contextFor(user) },
      ),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("event.update（010）", async () => {
    const user = await createUser();
    await expect(
      call(
        router.event.update,
        { id: crypto.randomUUID(), date: "2026-01-01", title: "予定", kind: "plan", repeatYearly: false, isShared: false },
        { context: contextFor(user) },
      ),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("event.delete（010）", async () => {
    const user = await createUser();
    await expect(
      call(router.event.delete, { id: crypto.randomUUID() }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("stats.get（012）", async () => {
    const user = await createUser();
    await expect(call(router.stats.get, undefined, { context: contextFor(user) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  it("memory.get（013）", async () => {
    const user = await createUser();
    await expect(call(router.memory.get, undefined, { context: contextFor(user) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  it("wish.list（027）", async () => {
    const user = await createUser();
    await expect(call(router.wish.list, {}, { context: contextFor(user) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  it("wish.create（027）", async () => {
    const user = await createUser();
    await expect(
      call(router.wish.create, { title: "行きたい場所" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("wish.update（028）", async () => {
    const user = await createUser();
    await expect(
      call(router.wish.update, { id: crypto.randomUUID(), title: "行きたい場所" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("wish.setDone（027）", async () => {
    const user = await createUser();
    await expect(
      call(router.wish.setDone, { id: crypto.randomUUID(), done: true }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("wish.delete（027）", async () => {
    const user = await createUser();
    await expect(
      call(router.wish.delete, { id: crypto.randomUUID() }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("mood.setToday（029）", async () => {
    const user = await createUser();
    await expect(
      call(router.mood.setToday, { level: 3 }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("mood.clearToday（029）", async () => {
    const user = await createUser();
    await expect(call(router.mood.clearToday, undefined, { context: contextFor(user) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  it("mood.list（029）", async () => {
    const user = await createUser();
    await expect(
      call(router.mood.list, { from: "2026-01-01", to: "2026-01-31" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });
});

describe("5. DEMO_COUPLE_ID が未設定のとき、未認証アクセスが拒否される（fail-closed）", () => {
  it("couple.get は未設定なら FORBIDDEN（全ペアのデータが漏れる形にしない）", async () => {
    await expect(call(router.couple.get, undefined, { context: contextFor(null, null) })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("空文字も未設定として扱われ FORBIDDEN", async () => {
    await expect(call(router.couple.get, undefined, { context: contextFor(null, "") })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

// L5とは別経路。L5は値が無い場合、6は値が有るが指す先が違う場合
// （security-requirements.md 3節）。`resolveCoupleContext`は冒頭で
// `if (!demoCoupleId)`を弾くため、5のテスト（nullと空文字）だけでは
// `AND is_demo = 1`を誰かが外しても1件も落ちない（Rが走査して確認済み）。
// security-auditor指摘: 021（認可を触るタスク）でこの項目のテストが
// リポジトリ全体に1件も存在しないと判明したため、ここで追加する
describe("6. DEMO_COUPLE_ID が実在するが is_demo でないペアを指すとき、未認証アクセスが拒否される", () => {
  it("couple.get は実在の非デモペアを指しても FORBIDDEN", async () => {
    const owner = await createUser();
    const realCouple = await createCouple(owner);

    await expect(
      call(router.couple.get, undefined, { context: contextFor(null, realCouple.id) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("event.list は実在の非デモペアを指しても FORBIDDEN（読み取りも拒否）", async () => {
    const owner = await createUser();
    const realCouple = await createCouple(owner);

    await expect(
      call(router.event.list, { from: "2026-01-01", to: "2026-01-31" }, { context: contextFor(null, realCouple.id) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// 021: ペアの内側で権限が分かれるのは plan だけ（docs/tasks/021-plan-ownership.md）。
// 1〜6は「他のペアに触れない」か「未認証を通さない」の話で、ペアの内側は
// 同じ権限という前提に立っていた。7はその前提が変わったことを確認する
describe("7. ペアのもう1人が、共有でない plan を更新・削除できない", () => {
  async function createCoupleOfTwo() {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
    return { owner, partner };
  }

  it("event.update: 共有でない plan は設定者以外が更新できない（NOT_FOUND）", async () => {
    const { owner, partner } = await createCoupleOfTwo();
    const plan = await call(
      router.event.create,
      { date: "2026-01-01", title: "個人の予定", kind: "plan", repeatYearly: false, isShared: false },
      { context: contextFor(owner) },
    );

    await expect(
      call(
        router.event.update,
        { id: plan.id, date: "2026-01-01", title: "改ざん", kind: "plan", repeatYearly: false, isShared: false },
        { context: contextFor(partner) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT title FROM events WHERE id = ?1").bind(plan.id).first<{ title: string }>();
    expect(row?.title).toBe("個人の予定");
  });

  it("event.delete: 共有でない plan は設定者以外が削除できない（NOT_FOUND）", async () => {
    const { owner, partner } = await createCoupleOfTwo();
    const plan = await call(
      router.event.create,
      { date: "2026-01-01", title: "個人の予定", kind: "plan", repeatYearly: false, isShared: false },
      { context: contextFor(owner) },
    );

    await expect(call(router.event.delete, { id: plan.id }, { context: contextFor(partner) })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );

    const row = await db.prepare("SELECT id FROM events WHERE id = ?1").bind(plan.id).first();
    expect(row).not.toBeNull();
  });

  it("is_shared=1 の plan は設定者以外でも更新・削除できる", async () => {
    const { owner, partner } = await createCoupleOfTwo();
    const plan = await call(
      router.event.create,
      { date: "2026-01-01", title: "ふたりの予定", kind: "plan", repeatYearly: false, isShared: true },
      { context: contextFor(owner) },
    );

    const updated = await call(
      router.event.update,
      { id: plan.id, date: "2026-01-01", title: "相手が編集", kind: "plan", repeatYearly: false, isShared: true },
      { context: contextFor(partner) },
    );
    expect(updated.title).toBe("相手が編集");

    const deleted = await call(router.event.delete, { id: plan.id }, { context: contextFor(partner) });
    expect(deleted.id).toBe(plan.id);
  });

  it("anniversary/meetup は変えていない。設定者以外でも更新・削除できる", async () => {
    const { owner, partner } = await createCoupleOfTwo();
    const anniversary = await call(
      router.event.create,
      { date: "2026-01-01", title: "記念日", kind: "anniversary", repeatYearly: true, isShared: false },
      { context: contextFor(owner) },
    );

    const updated = await call(
      router.event.update,
      { id: anniversary.id, date: "2026-01-01", title: "相手が編集", kind: "anniversary", repeatYearly: true, isShared: false },
      { context: contextFor(partner) },
    );
    expect(updated.title).toBe("相手が編集");

    const deleted = await call(router.event.delete, { id: anniversary.id }, { context: contextFor(partner) });
    expect(deleted.id).toBe(anniversary.id);
  });
});

// security-requirements.md 3節の項目8。security-auditorが「kindの変更が
// 権限を奪う」経路を発見した（docs/tasks/021-plan-ownership.md）。
// 「誰かが誰かを締め出す」ではなく「自分を締め出す更新を拒む」形で塞ぐ
// Rが2段階での迂回を発見（meetup→共有plan→〈持ち主が〉非共有plan。単独では
// 正しい2つの更新をつなぐと、1段階で塞いだのと同じ終着点に着く）。
// AがWHERE句を「この操作が安全か」ではなく「この状態遷移が許されるか」で
// 書き直す判断をした: kind<>'plan'からkind='plan'への変換そのものを拒む
// （区分をまたぐ変換だけを見る。plan内の共有/非共有は持ち主が決めてよいため
// 変えていない）。「いまの4件はすべて設定者でない側が主語で、設定者による
// 操作が1件も試されていなかった」という指摘（Rが主語の分布を見て発見）を
// 踏まえ、設定者・設定者でない側の両方を主語にしたテストを揃える
describe("8. 更新の結果、この行を編集できなくなる側が生まれる更新を拒否する", () => {
  async function createCoupleOfTwo() {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
    return { owner, partner };
  }

  it("設定者でない側が、記念日を「非共有のplan」にする更新は拒まれる（NOT_FOUND）", async () => {
    const { owner, partner } = await createCoupleOfTwo();
    const anniversary = await call(
      router.event.create,
      { date: "2026-01-01", title: "記念日", kind: "anniversary", repeatYearly: true, isShared: false },
      { context: contextFor(owner) },
    );

    await expect(
      call(
        router.event.update,
        { id: anniversary.id, date: "2026-01-01", title: "改変", kind: "plan", repeatYearly: false, isShared: false },
        { context: contextFor(partner) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT kind FROM events WHERE id = ?1").bind(anniversary.id).first<{ kind: string }>();
    expect(row?.kind).toBe("anniversary");
  });

  it("設定者が、自分の記念日を「非共有のplan」にする更新も拒まれる（NOT_FOUND。当初これが通っていた）", async () => {
    const { owner } = await createCoupleOfTwo();
    const anniversary = await call(
      router.event.create,
      { date: "2026-01-01", title: "記念日", kind: "anniversary", repeatYearly: true, isShared: false },
      { context: contextFor(owner) },
    );

    await expect(
      call(
        router.event.update,
        { id: anniversary.id, date: "2026-01-01", title: "改変", kind: "plan", repeatYearly: false, isShared: false },
        { context: contextFor(owner) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT kind FROM events WHERE id = ?1").bind(anniversary.id).first<{ kind: string }>();
    expect(row?.kind).toBe("anniversary");
  });

  it("設定者でない側が、共有のplanの共有を外す更新は拒まれる（NOT_FOUND）", async () => {
    const { owner, partner } = await createCoupleOfTwo();
    const plan = await call(
      router.event.create,
      { date: "2026-01-01", title: "ふたりの予定", kind: "plan", repeatYearly: false, isShared: true },
      { context: contextFor(owner) },
    );

    await expect(
      call(
        router.event.update,
        { id: plan.id, date: "2026-01-01", title: "改変", kind: "plan", repeatYearly: false, isShared: false },
        { context: contextFor(partner) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT is_shared FROM events WHERE id = ?1").bind(plan.id).first<{ is_shared: number }>();
    expect(row?.is_shared).toBe(1);
  });

  it("設定者が、記念日を「共有のplan」にする更新も拒まれる（NOT_FOUND。2段階での迂回を防ぐため当初は通していたが閉じた）", async () => {
    const { owner } = await createCoupleOfTwo();
    const anniversary = await call(
      router.event.create,
      { date: "2026-01-01", title: "記念日", kind: "anniversary", repeatYearly: true, isShared: false },
      { context: contextFor(owner) },
    );

    await expect(
      call(
        router.event.update,
        { id: anniversary.id, date: "2026-01-01", title: "改変", kind: "plan", repeatYearly: false, isShared: true },
        { context: contextFor(owner) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT kind FROM events WHERE id = ?1").bind(anniversary.id).first<{ kind: string }>();
    expect(row?.kind).toBe("anniversary");
  });

  it("設定者でない側が、記念日を「共有のplan」にする更新も拒まれる（NOT_FOUND。同上）", async () => {
    const { owner, partner } = await createCoupleOfTwo();
    const anniversary = await call(
      router.event.create,
      { date: "2026-01-01", title: "記念日", kind: "anniversary", repeatYearly: true, isShared: false },
      { context: contextFor(owner) },
    );

    await expect(
      call(
        router.event.update,
        { id: anniversary.id, date: "2026-01-01", title: "改変", kind: "plan", repeatYearly: false, isShared: true },
        { context: contextFor(partner) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT kind FROM events WHERE id = ?1").bind(anniversary.id).first<{ kind: string }>();
    expect(row?.kind).toBe("anniversary");
  });

  it("meetupを共有planに変える更新→（成功していれば）持ち主が非共有にする更新、と続けて呼んでも、1回目（共有planへの変換）で拒まれる（Rが発見した2段階の迂回）", async () => {
    const { owner } = await createCoupleOfTwo();
    const meetup = await call(
      router.event.create,
      { date: "2026-01-01", title: "会った日", kind: "meetup", repeatYearly: false, isShared: false },
      { context: contextFor(owner) },
    );

    // step1: meetup → 共有plan（持ち主による操作。単独では「安全に見える」更新）
    await expect(
      call(
        router.event.update,
        { id: meetup.id, date: "2026-01-01", title: "改変", kind: "plan", repeatYearly: false, isShared: true },
        { context: contextFor(owner) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // step1が拒まれた以上、kindはmeetupのまま。step2（非共有化）を試す前提が無い
    const row = await db.prepare("SELECT kind FROM events WHERE id = ?1").bind(meetup.id).first<{ kind: string }>();
    expect(row?.kind).toBe("meetup");
  });

  it("どちらでも、planを記念日・会った日にする更新は通る（権限が広がる向き）", async () => {
    const { owner, partner } = await createCoupleOfTwo();
    const sharedPlan = await call(
      router.event.create,
      { date: "2026-01-01", title: "ふたりの予定", kind: "plan", repeatYearly: false, isShared: true },
      { context: contextFor(owner) },
    );

    const updatedByPartner = await call(
      router.event.update,
      { id: sharedPlan.id, date: "2026-01-01", title: "会った", kind: "meetup", repeatYearly: false, isShared: false },
      { context: contextFor(partner) },
    );
    expect(updatedByPartner.kind).toBe("meetup");

    const ownPlan = await call(
      router.event.create,
      { date: "2026-01-02", title: "自分の予定", kind: "plan", repeatYearly: false, isShared: false },
      { context: contextFor(owner) },
    );
    const updatedByOwner = await call(
      router.event.update,
      { id: ownPlan.id, date: "2026-01-02", title: "記念日に", kind: "anniversary", repeatYearly: true, isShared: false },
      { context: contextFor(owner) },
    );
    expect(updatedByOwner.kind).toBe("anniversary");
  });

  it("記念日↔会った日はどちらでも変更できる（区分をまたがない。変えていない）", async () => {
    const { owner, partner } = await createCoupleOfTwo();
    const anniversary = await call(
      router.event.create,
      { date: "2026-01-01", title: "記念日", kind: "anniversary", repeatYearly: true, isShared: false },
      { context: contextFor(owner) },
    );

    const toMeetup = await call(
      router.event.update,
      { id: anniversary.id, date: "2026-01-01", title: "会った日に", kind: "meetup", repeatYearly: false, isShared: false },
      { context: contextFor(partner) },
    );
    expect(toMeetup.kind).toBe("meetup");

    const backToAnniversary = await call(
      router.event.update,
      { id: anniversary.id, date: "2026-01-01", title: "記念日に戻す", kind: "anniversary", repeatYearly: true, isShared: false },
      { context: contextFor(owner) },
    );
    expect(backToAnniversary.kind).toBe("anniversary");
  });

  it("設定者が、自分のplanの共有を外す更新は通る（plan内の共有/非共有は持ち主が決めてよい）", async () => {
    const { owner } = await createCoupleOfTwo();
    const plan = await call(
      router.event.create,
      { date: "2026-01-01", title: "ふたりの予定", kind: "plan", repeatYearly: false, isShared: true },
      { context: contextFor(owner) },
    );

    const updated = await call(
      router.event.update,
      { id: plan.id, date: "2026-01-01", title: "改変", kind: "plan", repeatYearly: false, isShared: false },
      { context: contextFor(owner) },
    );
    expect(updated.isShared).toBe(false);
  });
});

// health.get / me.get は couple_id を必要としない手続きなので、認可の基底
// （readProcedure/writeProcedure/authedProcedure）を経由しない。これは意図的な
// 例外であり、それ以外の全手続きは必ずいずれかの基底を経由していなければならない
const ALLOWED_WITHOUT_BASE = new Set(["health.get", "me.get"]);

// router を再帰的に辿り、leaf（procedure）を "couple.get" のようなパス付きで集める
function collectProcedures(node: unknown, path: string[] = []): Array<{ path: string; procedure: unknown }> {
  if (isProcedure(node)) {
    return [{ path: path.join("."), procedure: node }];
  }
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) => collectProcedures(value, [...path, key]));
  }
  return [];
}

describe("認可の基底（readProcedure/writeProcedure/authedProcedure）を経由しない手続きが無い", () => {
  // 「手続きごとに認可を書くと必ずどこかで書き忘れる」（security-requirements.md 3節）を
  // 機械的に検出する。.use() の書き忘れは型エラーにならないため、これが唯一の防御線
  // （security-auditor 005監査 Medium指摘: authedProcedure の追加だけでは
  // 「.use() を丸ごと忘れる」経路は塞げない。Rレビューで指摘され追加した）
  it("許可リストに無い手続きは、3基底のいずれかを経由している", () => {
    const procedures = collectProcedures(router);
    // 空配列だと以下のループが何もチェックせず成功してしまうため、実在数を保証する
    // （029時点: health.get/me.get/me.update/me.uploadImageUrl/me.delete + couple 3 +
    // invite 2 + post 4 + reaction 1 + event 4 + stats 1 + memory 1 + wish 5 + mood 3 = 29）
    expect(procedures.length).toBeGreaterThanOrEqual(29);

    // 「ミドルウェアが1つ以上ある」だけでは、ログ計測等の無関係なミドルウェアを
    // 足しただけで .use(writeProcedure) の書き忘れを見逃す。実際にこの3つの
    // 関数が含まれているかを検査する（Rレビュー005 往復2回目の指摘）
    const bases: readonly unknown[] = [readProcedure, writeProcedure, authedProcedure];

    for (const { path, procedure } of procedures) {
      if (ALLOWED_WITHOUT_BASE.has(path)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const middlewares = (procedure as any)["~orpc"].middlewares as readonly unknown[];
      expect(
        middlewares.some((m) => bases.includes(m)),
        `${path} が認可の基底を経由していません`,
      ).toBe(true);
    }
  });

  it("許可リストの手続きが実際に router 上に存在する（リネーム・削除で空文字チェックにならないように）", () => {
    const paths = new Set(collectProcedures(router).map((p) => p.path));
    for (const allowed of ALLOWED_WITHOUT_BASE) {
      expect(paths.has(allowed), `${allowed} が router に存在しません`).toBe(true);
    }
  });
});

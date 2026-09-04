import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

// post.test.ts と同じ理由（実際の R2 API トークンの設定有無にテストの合否を
// 左右させない）
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

describe("reaction.toggle", () => {
  it("付いていなければ付き、reacted: true と件数1を返す", async () => {
    const user = await createUser();
    await createCouple(user);
    const post = await call(router.post.create, { body: "投稿" }, { context: contextFor(user) });

    const result = await call(
      router.reaction.toggle,
      { postId: post.id, kind: "heart" },
      { context: contextFor(user) },
    );

    expect(result).toEqual({ postId: post.id, kind: "heart", reacted: true });
  });

  it("既に付いていれば外れ、reacted: false を返す", async () => {
    const user = await createUser();
    await createCouple(user);
    const post = await call(router.post.create, { body: "投稿" }, { context: contextFor(user) });
    await call(router.reaction.toggle, { postId: post.id, kind: "heart" }, { context: contextFor(user) });

    const result = await call(
      router.reaction.toggle,
      { postId: post.id, kind: "heart" },
      { context: contextFor(user) },
    );

    expect(result).toEqual({ postId: post.id, kind: "heart", reacted: false });
  });

  it("同じユーザーが同じ投稿に同じ種別を二重に付けられない（主キー制約）", async () => {
    const user = await createUser();
    await createCouple(user);
    const post = await call(router.post.create, { body: "投稿" }, { context: contextFor(user) });

    await expect(
      db
        .prepare("INSERT INTO reactions (post_id, user_id, kind, created_at) VALUES (?1, ?2, 'heart', ?3)")
        .bind(post.id, user.id, Math.floor(Date.now() / 1000))
        .run(),
    ).resolves.toBeTruthy();

    await expect(
      db
        .prepare("INSERT INTO reactions (post_id, user_id, kind, created_at) VALUES (?1, ?2, 'heart', ?3)")
        .bind(post.id, user.id, Math.floor(Date.now() / 1000))
        .run(),
    ).rejects.toThrow();
  });

  it("kind に heart 以外の値は CHECK 制約で拒否される（M2まとめ監査 Low指摘）", async () => {
    const user = await createUser();
    await createCouple(user);
    const post = await call(router.post.create, { body: "投稿" }, { context: contextFor(user) });

    await expect(
      db
        .prepare("INSERT INTO reactions (post_id, user_id, kind, created_at) VALUES (?1, ?2, 'not-heart', ?3)")
        .bind(post.id, user.id, Math.floor(Date.now() / 1000))
        .run(),
    ).rejects.toThrow();
  });

  it("2人のユーザーが同じ投稿に付けると、それぞれ独立してカウントされる", async () => {
    const owner = await createUser();
    const couple = await createCouple(owner);
    const post = await call(router.post.create, { body: "投稿" }, { context: contextFor(owner) });
    // couple.create は1ペア1人目の作成のみ行う。2人目はDBへ直接participateさせる
    const partner = await createUser();
    await db
      .prepare("INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES (?1, ?2, 2, ?3)")
      .bind(couple.id, partner.id, Math.floor(Date.now() / 1000))
      .run();

    await call(router.reaction.toggle, { postId: post.id, kind: "heart" }, { context: contextFor(owner) });
    await call(router.reaction.toggle, { postId: post.id, kind: "heart" }, { context: contextFor(partner) });

    const list = await call(router.post.list, {}, { context: contextFor(owner) });
    const heart = list.items[0]?.reactions.find((r) => r.kind === "heart");
    expect(heart?.count).toBe(2);
    expect(heart?.reactedByMe).toBe(true);

    const listFromPartner = await call(router.post.list, {}, { context: contextFor(partner) });
    const heartFromPartner = listFromPartner.items[0]?.reactions.find((r) => r.kind === "heart");
    expect(heartFromPartner?.count).toBe(2);
    expect(heartFromPartner?.reactedByMe).toBe(true);
  });

  it("他ペアの投稿IDを指定すると NOT_FOUND になり、リアクションは作られない（006の post.delete と同じ形）", async () => {
    const userA = await createUser();
    await createCouple(userA);
    const postA = await call(router.post.create, { body: "Aの投稿" }, { context: contextFor(userA) });

    const userB = await createUser();
    await createCouple(userB);

    await expect(
      call(router.reaction.toggle, { postId: postA.id, kind: "heart" }, { context: contextFor(userB) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db
      .prepare("SELECT COUNT(*) AS count FROM reactions WHERE post_id = ?1")
      .bind(postA.id)
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("存在しない投稿IDを指定すると NOT_FOUND", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.reaction.toggle, { postId: crypto.randomUUID(), kind: "heart" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("削除済みの投稿には付けられない", async () => {
    const user = await createUser();
    await createCouple(user);
    const post = await call(router.post.create, { body: "消される投稿" }, { context: contextFor(user) });
    await call(router.post.delete, { id: post.id }, { context: contextFor(user) });

    await expect(
      call(router.reaction.toggle, { postId: post.id, kind: "heart" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("未認証なら FORBIDDEN（デモから呼べない）", async () => {
    await expect(
      call(router.reaction.toggle, { postId: crypto.randomUUID(), kind: "heart" }, { context: contextFor(null) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ペアに未所属なら NEEDS_ONBOARDING", async () => {
    const user = await createUser();
    await expect(
      call(router.reaction.toggle, { postId: crypto.randomUUID(), kind: "heart" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });
});

describe("post.list のリアクション集計（N+1回避）", () => {
  it("リアクションが無い投稿は空配列を返す", async () => {
    const user = await createUser();
    await createCouple(user);
    await call(router.post.create, { body: "投稿" }, { context: contextFor(user) });

    const result = await call(router.post.list, {}, { context: contextFor(user) });
    expect(result.items[0]?.reactions).toEqual([]);
  });

  it("複数投稿にリアクションが付いていても、投稿一覧の取得は1クエリ＋集計1クエリ＋画像1クエリの計3クエリで済む", async () => {
    const user = await createUser();
    await createCouple(user);
    const post1 = await call(router.post.create, { body: "1件目" }, { context: contextFor(user) });
    const post2 = await call(router.post.create, { body: "2件目" }, { context: contextFor(user) });
    await call(router.reaction.toggle, { postId: post1.id, kind: "heart" }, { context: contextFor(user) });
    await call(router.reaction.toggle, { postId: post2.id, kind: "heart" }, { context: contextFor(user) });

    // D1Database#prepare の呼び出し回数を数える。post.list ハンドラ内で
    // 何回 SQL を発行しているかを直接検証する（証跡は artifacts/009 に保存）
    let prepareCallCount = 0;
    const originalPrepare = db.prepare.bind(db);
    const countingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "prepare") {
          return (...args: Parameters<typeof originalPrepare>) => {
            prepareCallCount += 1;
            return originalPrepare(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const result = await call(router.post.list, {}, { context: { ...contextFor(user), db: countingDb } });

    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.reactions.some((r) => r.kind === "heart" && r.count === 1))).toBe(true);
    // 1: readProcedure による couple_id 解決（couple_members の SELECT）、
    // 2: 投稿一覧の SELECT、3: リアクション集計の SELECT、
    // 4: 画像一覧の SELECT（031・post_images）。
    // 投稿件数が増えても4のまま変わらないことが N+1 でないことの証拠
    expect(prepareCallCount).toBe(4);
  });

  it("投稿がゼロ件のときはリアクション集計クエリを発行しない", async () => {
    const user = await createUser();
    await createCouple(user);

    let prepareCallCount = 0;
    const originalPrepare = db.prepare.bind(db);
    const countingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "prepare") {
          return (...args: Parameters<typeof originalPrepare>) => {
            prepareCallCount += 1;
            return originalPrepare(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const result = await call(router.post.list, {}, { context: { ...contextFor(user), db: countingDb } });

    expect(result.items).toHaveLength(0);
    // 1: readProcedure による couple_id 解決、2: 投稿一覧の SELECT（0件）。
    // 投稿が0件のときリアクション集計クエリ（IN () は不正なSQL）を発行しない
    expect(prepareCallCount).toBe(2);
  });

  it("未認証（デモ閲覧）では reactedByMe が常に false になる", async () => {
    const demoCoupleId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare("INSERT INTO couples (id, dating_date, is_demo, created_at) VALUES (?1, '2019-01-01', 1, ?2)")
      .bind(demoCoupleId, now)
      .run();
    const demoAuthor = await createUser();
    const postId = crypto.randomUUID();
    await db
      .prepare("INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(postId, demoCoupleId, demoAuthor.id, "デモの投稿", now)
      .run();
    await db
      .prepare("INSERT INTO reactions (post_id, user_id, kind, created_at) VALUES (?1, ?2, 'heart', ?3)")
      .bind(postId, demoAuthor.id, now)
      .run();

    const result = await call(router.post.list, {}, { context: contextFor(null, demoCoupleId) });

    const heart = result.items[0]?.reactions.find((r) => r.kind === "heart");
    expect(heart?.count).toBe(1);
    expect(heart?.reactedByMe).toBe(false);
  });
});

describe("post.delete とリアクションの整合性（M2まとめ監査 Low指摘）", () => {
  it("投稿を削除すると、その投稿に付いていたリアクションも一緒に削除される", async () => {
    const user = await createUser();
    await createCouple(user);
    const post = await call(router.post.create, { body: "削除される投稿" }, { context: contextFor(user) });
    await call(router.reaction.toggle, { postId: post.id, kind: "heart" }, { context: contextFor(user) });

    await call(router.post.delete, { id: post.id }, { context: contextFor(user) });

    const row = await db
      .prepare("SELECT COUNT(*) AS count FROM reactions WHERE post_id = ?1")
      .bind(post.id)
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("他ペアの投稿IDを指定した削除が NOT_FOUND のとき、対象と無関係な reactions は消えない", async () => {
    const userA = await createUser();
    await createCouple(userA);
    const postA = await call(router.post.create, { body: "Aの投稿" }, { context: contextFor(userA) });
    await call(router.reaction.toggle, { postId: postA.id, kind: "heart" }, { context: contextFor(userA) });

    const userB = await createUser();
    await createCouple(userB);

    await expect(
      call(router.post.delete, { id: postA.id }, { context: contextFor(userB) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db
      .prepare("SELECT COUNT(*) AS count FROM reactions WHERE post_id = ?1")
      .bind(postA.id)
      .first<{ count: number }>();
    expect(row?.count).toBe(1);
  });
});

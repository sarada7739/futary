import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

// event.test.tsと同じ理由（実際のR2 APIトークンの設定有無にテストの合否を左右させない）
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

async function createWish(
  user: { id: string; name: string; email: string },
  title = "水族館に行く",
  note?: string,
) {
  return call(router.wish.create, { title, note }, { context: contextFor(user) });
}

describe("wish.create / wish.list（基本のCRUD）", () => {
  it("作成したものがそのまま一覧に出る（doneAtはnull・createdByNameが設定者）", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user, "花火大会を見る");

    const result = await call(router.wish.list, {}, { context: contextFor(user) });

    expect(result.items).toEqual([
      {
        id: created.id,
        title: "花火大会を見る",
        note: "",
        doneAt: null,
        createdAt: created.createdAt,
        createdByName: user.name,
      },
    ]);
  });

  it("noteを付けて作成できる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user, "水族館に行く", "駅前の新しいところ");
    expect(created.note).toBe("駅前の新しいところ");
  });

  it("noteが200文字ちょうどなら作れる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user, "行く", "あ".repeat(200));
    expect(created.note).toHaveLength(200);
  });

  it("noteが200文字を超えるとINVALID_INPUT", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.wish.create, { title: "行く", note: "あ".repeat(201) }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("noteを省略しても空文字で作れる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user);
    expect(created.note).toBe("");
  });

  it("titleがtrim後に空なら拒む", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(call(router.wish.create, { title: "   " }, { context: contextFor(user) })).rejects.toThrow();
  });

  // security-auditor指摘（028）: noteの201文字（上限超え）テストはあったが、
  // titleの101文字（上限超え）テストが無く、procedures/wish.tsの
  // assertValidTitleが唯一の保証になっていることを固定するテストが片方
  // 欠けていた
  it("titleが100文字ちょうどなら作れる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user, "あ".repeat(100));
    expect(created.title).toHaveLength(100);
  });

  it("titleが100文字を超えるとINVALID_INPUT", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.wish.create, { title: "あ".repeat(101) }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("titleは前後の空白がtrimされて保存される", async () => {
    const user = await createUser();
    await createCouple(user);

    const created = await createWish(user, "  カフェを開拓する  ");
    expect(created.title).toBe("カフェを開拓する");
  });

  it("他ペアのものは一覧に混ざらない", async () => {
    const userA = await createUser();
    await createCouple(userA);
    await createWish(userA, "Aの行きたい場所");

    const userB = await createUser();
    await createCouple(userB);
    await createWish(userB, "Bの行きたい場所");

    const result = await call(router.wish.list, {}, { context: contextFor(userA) });
    expect(result.items.map((w) => w.title)).toEqual(["Aの行きたい場所"]);
  });

  // タスク定義8節: 並び順（未達成が先、達成済みが後。それぞれ新しい順）。
  // 同一秒内の作成ではcreated_at（秒単位）が同値になりうるため、作成後に
  // created_atを直接書き換えて順序を確定させる（event.test.tsの重複解消
  // テストと同じ考え方: SQLの並び替えロジック自体を検証する）
  it("未達成が先・達成済みが後。それぞれcreatedAtの新しい順", async () => {
    const user = await createUser();
    await createCouple(user);

    const undoneOld = await createWish(user, "未達成（古い）");
    const undoneNew = await createWish(user, "未達成（新しい）");
    const doneOld = await createWish(user, "達成済み（古い）");
    const doneNew = await createWish(user, "達成済み（新しい）");
    await db.prepare("UPDATE wishes SET created_at = ?1 WHERE id = ?2").bind(100, undoneOld.id).run();
    await db.prepare("UPDATE wishes SET created_at = ?1 WHERE id = ?2").bind(200, undoneNew.id).run();
    await db.prepare("UPDATE wishes SET created_at = ?1 WHERE id = ?2").bind(100, doneOld.id).run();
    await db.prepare("UPDATE wishes SET created_at = ?1 WHERE id = ?2").bind(200, doneNew.id).run();
    await call(router.wish.setDone, { id: doneOld.id, done: true }, { context: contextFor(user) });
    await call(router.wish.setDone, { id: doneNew.id, done: true }, { context: contextFor(user) });

    const result = await call(router.wish.list, {}, { context: contextFor(user) });
    expect(result.items.map((w) => w.id)).toEqual([undoneNew.id, undoneOld.id, doneNew.id, doneOld.id]);
  });
});

// 028: メモを足したことで「消して入れ直す」が成り立たなくなったため新設
describe("wish.update", () => {
  it("titleとnoteを両方更新できる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user, "元のタイトル", "元のメモ");

    const updated = await call(
      router.wish.update,
      { id: created.id, title: "新しいタイトル", note: "新しいメモ" },
      { context: contextFor(user) },
    );

    expect(updated.title).toBe("新しいタイトル");
    expect(updated.note).toBe("新しいメモ");
  });

  it("titleだけ更新するとnoteは変わらない", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user, "元のタイトル", "残るはずのメモ");

    const updated = await call(
      router.wish.update,
      { id: created.id, title: "新しいタイトル" },
      { context: contextFor(user) },
    );

    expect(updated.title).toBe("新しいタイトル");
    expect(updated.note).toBe("残るはずのメモ");
  });

  it("noteだけ更新するとtitleは変わらない", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user, "残るはずのタイトル", "元のメモ");

    const updated = await call(
      router.wish.update,
      { id: created.id, note: "新しいメモ" },
      { context: contextFor(user) },
    );

    expect(updated.title).toBe("残るはずのタイトル");
    expect(updated.note).toBe("新しいメモ");
  });

  it("noteを空文字にして消せる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user, "タイトル", "消されるメモ");

    const updated = await call(
      router.wish.update,
      { id: created.id, note: "" },
      { context: contextFor(user) },
    );

    expect(updated.note).toBe("");
  });

  it("titleがtrim後に空ならINVALID_INPUT", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user);

    await expect(
      call(router.wish.update, { id: created.id, title: "   " }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("noteが200文字を超えるとINVALID_INPUT", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user);

    await expect(
      call(router.wish.update, { id: created.id, note: "あ".repeat(201) }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  // security-auditor指摘（028）: wish.createと対称に、updateでもtitleの
  // 境界値（100文字は通る・101文字は拒む）を固定する
  it("titleを100文字ちょうどに更新できる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user);

    const updated = await call(
      router.wish.update,
      { id: created.id, title: "あ".repeat(100) },
      { context: contextFor(user) },
    );
    expect(updated.title).toHaveLength(100);
  });

  it("titleを100文字を超えて更新するとINVALID_INPUT", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user);

    await expect(
      call(router.wish.update, { id: created.id, title: "あ".repeat(101) }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  // タスク定義1節: 設定者は編集しても変わらない
  it("相手が編集しても、設定者の名前（createdByName）は変わらない", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
    const created = await createWish(owner, "オーナーの行きたい場所");

    const updated = await call(
      router.wish.update,
      { id: created.id, note: "相手が書き足したメモ" },
      { context: contextFor(partner) },
    );

    expect(updated.createdByName).toBe(owner.name);
  });

  // タスク定義2節: 「相手が入れたwishを、もう1人が更新・削除できる」（現状維持の確認）
  it("作成者でないペアの相手もタイトル・メモを編集できる", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
    const created = await createWish(owner);

    const updated = await call(
      router.wish.update,
      { id: created.id, title: "相手が改題" },
      { context: contextFor(partner) },
    );

    expect(updated.title).toBe("相手が改題");
  });

  it("他ペアのidを指定するとNOT_FOUNDになり、対象は変わらない", async () => {
    const userA = await createUser();
    await createCouple(userA);
    const wishA = await createWish(userA, "Aのタイトル");

    const userB = await createUser();
    await createCouple(userB);

    await expect(
      call(router.wish.update, { id: wishA.id, title: "改ざん" }, { context: contextFor(userB) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT title FROM wishes WHERE id = ?1").bind(wishA.id).first<{ title: string }>();
    expect(row?.title).toBe("Aのタイトル");
  });

  it("存在しないidはNOT_FOUND", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.wish.update, { id: crypto.randomUUID(), title: "存在しない" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("削除済みのidはNOT_FOUND", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user);
    await call(router.wish.delete, { id: created.id }, { context: contextFor(user) });

    await expect(
      call(router.wish.update, { id: created.id, title: "復活させようとする" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("wish.setDone", () => {
  it("done:trueでチェックが付き、done:falseで外せる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user);

    const done = await call(router.wish.setDone, { id: created.id, done: true }, { context: contextFor(user) });
    expect(done.doneAt).not.toBeNull();

    const undone = await call(router.wish.setDone, { id: created.id, done: false }, { context: contextFor(user) });
    expect(undone.doneAt).toBeNull();
  });

  // タスク定義3節: 同じ要求が2回届いても結果が同じになる（冪等）。
  // toggleだと2回目でtrueに戻ってしまうが、setDoneは2回ともdoneAtが変わらない
  it("同じdoneを2回送っても結果が変わらない（冪等）", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user);

    const first = await call(router.wish.setDone, { id: created.id, done: true }, { context: contextFor(user) });
    const second = await call(router.wish.setDone, { id: created.id, done: true }, { context: contextFor(user) });
    expect(second.doneAt).toBe(first.doneAt);

    const third = await call(router.wish.setDone, { id: created.id, done: false }, { context: contextFor(user) });
    const fourth = await call(router.wish.setDone, { id: created.id, done: false }, { context: contextFor(user) });
    expect(fourth.doneAt).toBe(third.doneAt);
    expect(fourth.doneAt).toBeNull();
  });

  it("チェックを外して間違いを戻せる（達成済みが下から消えて戻る）", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user);
    await call(router.wish.setDone, { id: created.id, done: true }, { context: contextFor(user) });
    await call(router.wish.setDone, { id: created.id, done: false }, { context: contextFor(user) });

    const result = await call(router.wish.list, {}, { context: contextFor(user) });
    expect(result.items[0]?.doneAt).toBeNull();
  });

  it("他ペアのidを指定するとNOT_FOUNDになり、対象は変わらない", async () => {
    const userA = await createUser();
    await createCouple(userA);
    const wishA = await createWish(userA);

    const userB = await createUser();
    await createCouple(userB);

    await expect(
      call(router.wish.setDone, { id: wishA.id, done: true }, { context: contextFor(userB) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT done_at FROM wishes WHERE id = ?1").bind(wishA.id).first<{ done_at: number | null }>();
    expect(row?.done_at).toBeNull();
  });

  it("存在しないidはNOT_FOUND", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.wish.setDone, { id: crypto.randomUUID(), done: true }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // タスク定義4節: 権限はペアで共有。作成者に限定しない
  it("作成者でないペアの相手もチェックを付けられる", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
    const created = await createWish(owner);

    const done = await call(router.wish.setDone, { id: created.id, done: true }, { context: contextFor(partner) });
    expect(done.doneAt).not.toBeNull();
  });
});

describe("wish.delete", () => {
  it("削除した行はwish.listに出ない（論理削除）", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user);

    const result = await call(router.wish.delete, { id: created.id }, { context: contextFor(user) });
    expect(result.id).toBe(created.id);

    const list = await call(router.wish.list, {}, { context: contextFor(user) });
    expect(list.items).toHaveLength(0);

    const row = await db.prepare("SELECT deleted_at FROM wishes WHERE id = ?1").bind(created.id).first<{ deleted_at: number | null }>();
    expect(row?.deleted_at).not.toBeNull();
  });

  it("他ペアのidを指定した削除はNOT_FOUNDになり、対象は消えない", async () => {
    const userA = await createUser();
    await createCouple(userA);
    const wishA = await createWish(userA);

    const userB = await createUser();
    await createCouple(userB);

    await expect(
      call(router.wish.delete, { id: wishA.id }, { context: contextFor(userB) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT id FROM wishes WHERE id = ?1 AND deleted_at IS NULL").bind(wishA.id).first();
    expect(row).not.toBeNull();
  });

  it("作成者でないペアの相手も削除できる", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
    const created = await createWish(owner);

    const deleted = await call(router.wish.delete, { id: created.id }, { context: contextFor(partner) });
    expect(deleted.id).toBe(created.id);
  });

  it("既に削除済みのidをもう一度削除するとNOT_FOUND", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createWish(user);
    await call(router.wish.delete, { id: created.id }, { context: contextFor(user) });

    await expect(
      call(router.wish.delete, { id: created.id }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// タスク定義5節: 1ペア200件を上限とし、サーバ側で拒む（未削除・達成済みを含む）
describe("wish.create の上限（LIMIT_REACHED）", () => {
  it("200件目までは作れて、201件目はLIMIT_REACHEDで拒まれる", async () => {
    const user = await createUser();
    const couple = await createCouple(user);

    for (let i = 0; i < 200; i++) {
      await db
        .prepare(
          `INSERT INTO wishes (id, couple_id, title, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(crypto.randomUUID(), couple.id, `項目${i}`, user.id, i)
        .run();
    }

    await expect(createWish(user, "201件目")).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });

  it("達成済みの行も上限の数に含まれる", async () => {
    const user = await createUser();
    await createCouple(user);
    const couple = await call(router.couple.get, undefined, { context: contextFor(user) });

    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 200; i++) {
      await db
        .prepare(
          `INSERT INTO wishes (id, couple_id, title, created_by, created_at, done_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
        )
        .bind(crypto.randomUUID(), couple.id, `達成済み${i}`, user.id, now)
        .run();
    }

    await expect(createWish(user, "201件目")).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });

  it("論理削除済みの行は上限の数に含まれない", async () => {
    const user = await createUser();
    await createCouple(user);
    const couple = await call(router.couple.get, undefined, { context: contextFor(user) });

    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 200; i++) {
      await db
        .prepare(
          `INSERT INTO wishes (id, couple_id, title, created_by, created_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
        )
        .bind(crypto.randomUUID(), couple.id, `削除済み${i}`, user.id, now)
        .run();
    }

    const created = await createWish(user, "上限に当たらないはず");
    expect(created.title).toBe("上限に当たらないはず");
  });
});

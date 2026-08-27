import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

const db = (env as unknown as Bindings).DB;

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
  ip: string | null = "203.0.113.1",
): RpcContext {
  return { db, user: user ? { ...user, image: null } : null, ip };
}

async function createCouple(user: { id: string; name: string; email: string }) {
  return call(router.couple.create, { anniversaryDate: "2020-01-01" }, { context: contextFor(user) });
}

describe("invite.issue", () => {
  it("6桁のコードと24時間後の有効期限を返す。コードは紛らわしい文字を含まない", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const before = Math.floor(Date.now() / 1000);

    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });

    expect(invite.code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(invite.expiresAt).toBeGreaterThanOrEqual(before + 24 * 60 * 60);
  });

  it("未認証なら FORBIDDEN", async () => {
    await expect(call(router.invite.issue, undefined, { context: contextFor(null) })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("ペアに未所属なら NEEDS_ONBOARDING", async () => {
    const user = await createUser();
    await expect(call(router.invite.issue, undefined, { context: contextFor(user) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  it("再発行すると前のコードが無効化される（同時に有効なコードは1件）", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const first = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    await call(router.invite.issue, undefined, { context: contextFor(owner) });

    const partner = await createUser();
    await expect(
      call(router.invite.accept, { code: first.code }, { context: contextFor(partner) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("invite.accept", () => {
  it("有効なコードで参加でき、スロット2が割り当てられる", async () => {
    const owner = await createUser();
    const couple = await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();

    const joined = await call(
      router.invite.accept,
      { code: invite.code },
      { context: contextFor(partner) },
    );

    expect(joined.id).toBe(couple.id);
    const member = await db
      .prepare("SELECT slot FROM couple_members WHERE couple_id = ?1 AND user_id = ?2")
      .bind(couple.id, partner.id)
      .first<{ slot: number }>();
    expect(member?.slot).toBe(2);
  });

  it("小文字で入力しても受け付けられる", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();

    await expect(
      call(router.invite.accept, { code: invite.code.toLowerCase() }, { context: contextFor(partner) }),
    ).resolves.toBeTruthy();
  });

  it("未認証なら FORBIDDEN", async () => {
    await expect(
      call(router.invite.accept, { code: "AAAAAA" }, { context: contextFor(null) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("文字集合に無い文字（0/O/1/Iなど）を含むコードは入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await expect(
      call(router.invite.accept, { code: "0O1I5A" }, { context: contextFor(user, "203.0.113.30") }),
    ).rejects.toThrow();
  });

  it("存在しないコードは NOT_FOUND", async () => {
    const user = await createUser();
    await expect(
      call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(user, "203.0.113.20") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("同じコードを2回使えない", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });

    const another = await createUser();
    await expect(
      call(router.invite.accept, { code: invite.code }, { context: contextFor(another, "203.0.113.21") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("期限切れのコードは使えず、used_at も刻まれない", async () => {
    const owner = await createUser();
    const couple = await createCouple(owner);
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        "INSERT INTO invites (code, couple_id, created_by, expires_at, used_at) VALUES ('EXPRDX', ?1, ?2, ?3, NULL)",
      )
      .bind(couple.id, owner.id, now - 1)
      .run();
    const partner = await createUser();

    await expect(
      call(router.invite.accept, { code: "EXPRDX" }, { context: contextFor(partner, "203.0.113.22") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const invite = await db
      .prepare("SELECT used_at FROM invites WHERE code = 'EXPRDX'")
      .first<{ used_at: number | null }>();
    expect(invite?.used_at).toBeNull();
  });

  it("1ペアに3人目は入れない（DBのCHECK/NOT NULL制約で失敗）", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const invite1 = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite1.code }, { context: contextFor(partner) });

    const invite2 = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const third = await createUser();

    // 招待コードの有効性が外部から判別できないよう、無効なコードと同じ NOT_FOUND を返す
    await expect(
      call(router.invite.accept, { code: invite2.code }, { context: contextFor(third, "203.0.113.23") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("既に別のペアに所属しているユーザーは参加できない（1人1ペアの制約）", async () => {
    const ownerA = await createUser();
    await createCouple(ownerA);
    const ownerB = await createUser();
    await createCouple(ownerB);
    const inviteA = await call(router.invite.issue, undefined, { context: contextFor(ownerA) });

    await expect(
      call(router.invite.accept, { code: inviteA.code }, { context: contextFor(ownerB, "203.0.113.24") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("invite.accept のレート制限（user_id/IP単位10回/時間）", () => {
  it("同一IPからの失敗が10回を超えると RATE_LIMITED になる", async () => {
    const user = await createUser();
    const ip = "198.51.100.9";

    for (let i = 0; i < 10; i++) {
      await expect(
        call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(user, ip) }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }

    await expect(
      call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(user, ip) }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("別ユーザー・別IPからは制限されない", async () => {
    const user = await createUser();
    for (let i = 0; i < 10; i++) {
      await call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(user, "198.51.100.10") }).catch(
        () => undefined,
      );
    }

    const otherUser = await createUser();
    await expect(
      call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(otherUser, "198.51.100.11") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("同一ユーザーはIPを変えても制限される（IPv6アドレスローテーションでの回避を防ぐ）", async () => {
    const user = await createUser();

    for (let i = 0; i < 10; i++) {
      // 毎回異なるIPから失敗させる
      await expect(
        call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(user, `198.51.100.${50 + i}`) }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }

    await expect(
      call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(user, "198.51.100.99") }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("IPが取得できない場合はuser_id単位で制限され、他ユーザーを巻き込まない", async () => {
    const user = await createUser();
    for (let i = 0; i < 10; i++) {
      await expect(
        call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(user, null) }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(
      call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(user, null) }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });

    // IPが同じく無い別ユーザーは影響を受けない（共有バケットに丸めていないことの確認）
    const otherUser = await createUser();
    await expect(
      call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(otherUser, null) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("並行リクエストでも失敗カウントの上限を超えて通過しない（TOCTOU対策）", async () => {
    const user = await createUser();
    const ip = "198.51.100.77";

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(user, ip) }),
      ),
    );

    const codes = results.map((r) => (r.status === "rejected" ? (r.reason as { code?: string }).code : "OK"));
    const notFoundCount = codes.filter((c) => c === "NOT_FOUND").length;
    const rateLimitedCount = codes.filter((c) => c === "RATE_LIMITED").length;

    expect(notFoundCount).toBe(10);
    expect(rateLimitedCount).toBe(10);
  });

  it("成功した試行はレート制限にカウントされない", async () => {
    const ip = "198.51.100.20";

    // 同一IPから10組ぶんの参加を成功させる（1ペアにつき参加できるのは1人まで）
    for (let i = 0; i < 10; i++) {
      const owner = await createUser();
      await createCouple(owner);
      const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
      const partner = await createUser();
      await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner, ip) });
    }

    // 失敗回数は0のはずなので、直後の1回の失敗は RATE_LIMITED にならず NOT_FOUND のまま
    const user = await createUser();
    await expect(
      call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(user, ip) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

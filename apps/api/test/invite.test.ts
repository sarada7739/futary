import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

// 実際の R2 API トークンの設定有無にテストの合否が左右されないよう、
// 署名鍵はテスト固有の固定値を使う（post.test.ts と同じ理由）
const r2Sign: RpcContext["r2Sign"] = {
  accountId: "test-account",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  bucketName: "test-bucket",
};

let userSeq = 0;

// accountIdを指定できるのは、削除→同じGoogleアカウントで再登録した状態
// （新しいuser.idだが同じaccount.account_id）を模擬するテストのため（024）
async function createUser(
  accountId?: string,
): Promise<{ id: string; name: string; email: string; accountId: string }> {
  userSeq += 1;
  const id = `user-${userSeq}-${crypto.randomUUID()}`;
  const name = `テストユーザー${userSeq}`;
  const email = `user-${userSeq}-${crypto.randomUUID()}@example.com`;
  const now = Math.floor(Date.now() / 1000);
  const resolvedAccountId = accountId ?? `google-sub-${crypto.randomUUID()}`;
  await db.batch([
    db
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
      )
      .bind(id, name, email, now),
    // invite.acceptはaccount_id（Googleの識別子）を必ず引く（このアプリは
    // Googleログインのみのため）。テストの利用者もaccount行を持たせる
    db
      .prepare(
        "INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at) VALUES (?1, 'google', ?2, 'google', ?3, ?4, ?4)",
      )
      .bind(crypto.randomUUID(), resolvedAccountId, id, now),
  ]);
  return { id, name, email, accountId: resolvedAccountId };
}

function contextFor(
  user: { id: string; name: string; email: string } | null,
  ip: string | null = "203.0.113.1",
  demoCoupleId: string | null = null,
): RpcContext {
  return {
    db,
    bucket,
    r2Sign,
    user: user ? { ...user, image: null } : null,
    ip,
    demoCoupleId,
    sessionCreatedAt: user ? Date.now() : null,
    authSecret: "test-secret",
  };
}

async function createCouple(user: { id: string; name: string; email: string }) {
  return call(router.couple.create, {}, { context: contextFor(user) });
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

  // 005: writeProcedure が mode === 'readonly'（未認証）を一律 FORBIDDEN にする
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
    const couple = await createCouple(owner);
    const invite1 = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite1.code }, { context: contextFor(partner) });

    // 満員のペアではinvite.issue自体がFORBIDDENになる（025）ため、
    // 正規の経路では有効なコードを作れない。ここではDB側の防御
    // （slotのNOT NULL制約）自体を確認するため、期限切れコードのテストと
    // 同じ手法で直接invitesテーブルへ差し込む
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        "INSERT INTO invites (code, couple_id, created_by, expires_at, used_at) VALUES ('FULLXX', ?1, ?2, ?3, NULL)",
      )
      .bind(couple.id, owner.id, now + 3600)
      .run();
    const third = await createUser();

    // 招待コードの有効性が外部から判別できないよう、無効なコードと同じ NOT_FOUND を返す
    await expect(
      call(router.invite.accept, { code: "FULLXX" }, { context: contextFor(third, "203.0.113.23") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 025: 満員のペアではinvite.issue自体をサーバ側で拒む（「画面に出さないから
  // 安全」は採らない。security-requirements.md T5と同じ考え方）
  it("ペアが2人揃っていると発行できない（FORBIDDEN）", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });

    await expect(
      call(router.invite.issue, undefined, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // どちらの利用者から呼んでも同じ
    await expect(
      call(router.invite.issue, undefined, { context: contextFor(partner) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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

describe("invite.accept のレート制限（account_hash/IP単位10回/時間）", () => {
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

  it("IPが取得できない場合はaccount_hash単位で制限され、他ユーザーを巻き込まない", async () => {
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

  // 024で発見・修正: 以前はuser_idをキーにしていたため、アカウントを削除して
  // 同じGoogleアカウントで登録し直すと新しいuser_idになり、失敗回数が
  // リセットされていた（削除→再登録を繰り返せば無制限に回避できた）。
  // account_hash（account.account_idの塩付きハッシュ）に差し替えたことで、
  // user_idが変わっても同じGoogleアカウントである限り同じバケットに乗る
  it("同じGoogleアカウントなら、user_idが変わっても（削除・再登録を模擬）失敗回数が引き継がれる", async () => {
    const sharedAccountId = `google-sub-${crypto.randomUUID()}`;
    const before = await createUser(sharedAccountId);
    const ip = "198.51.100.201";

    for (let i = 0; i < 10; i++) {
      await expect(
        call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(before, ip) }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }

    // 「削除して同じGoogleアカウントで登録し直す」を、同じaccountIdを持つ
    // 別のuser行として模擬する（024タスク定義）
    const after = await createUser(sharedAccountId);
    await expect(
      call(router.invite.accept, { code: "ZZZZZZ" }, { context: contextFor(after, ip) }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

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
  demoCoupleId: string | null = null,
): RpcContext {
  return { db, bucket, r2Sign, user: user ? { ...user, image: null } : null, ip, demoCoupleId };
}

describe("couple.create", () => {
  it("認証済みユーザーがペアを作成し、自分がスロット1で参加する", async () => {
    const user = await createUser();

    const couple = await call(
      router.couple.create,
      { anniversaryDate: "2020-01-01" },
      { context: contextFor(user) },
    );

    expect(couple.anniversaryDate).toBe("2020-01-01");

    const member = await db
      .prepare("SELECT slot FROM couple_members WHERE couple_id = ?1 AND user_id = ?2")
      .bind(couple.id, user.id)
      .first<{ slot: number }>();
    expect(member?.slot).toBe(1);
  });

  it("未認証なら FORBIDDEN", async () => {
    await expect(
      call(router.couple.create, { anniversaryDate: "2020-01-01" }, { context: contextFor(null) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("既に別のペアに所属しているユーザーは作成できない（1人1ペアの制約）", async () => {
    const user = await createUser();
    await call(router.couple.create, { anniversaryDate: "2020-01-01" }, { context: contextFor(user) });

    await expect(
      call(router.couple.create, { anniversaryDate: "2021-01-01" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("不正な日付形式は入力バリデーションで弾かれる", async () => {
    const user = await createUser();

    await expect(
      call(router.couple.create, { anniversaryDate: "2020/01/01" }, { context: contextFor(user) }),
    ).rejects.toThrow();
  });

  it("未来の日付は入力バリデーションで弾かれる", async () => {
    const user = await createUser();

    await expect(
      call(router.couple.create, { anniversaryDate: "9999-01-01" }, { context: contextFor(user) }),
    ).rejects.toThrow();
  });

  it("範囲外に古い日付は入力バリデーションで弾かれる", async () => {
    const user = await createUser();

    await expect(
      call(router.couple.create, { anniversaryDate: "1899-12-31" }, { context: contextFor(user) }),
    ).rejects.toThrow();
  });
});

describe("couple.get", () => {
  it("ペアに未所属なら NEEDS_ONBOARDING", async () => {
    const user = await createUser();

    await expect(call(router.couple.get, undefined, { context: contextFor(user) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  // 005: couple.get は readProcedure の上に載っており、未認証でも
  // DEMO_COUPLE_ID が設定されていれば通る（デモペアの読み取り）。
  // ここでは demoCoupleId 未設定（デフォルト null）のケースを見ている。
  // fail-closed の網羅的な検証は test/authorization.test.ts の5番目の項目を参照
  it("未認証かつ DEMO_COUPLE_ID 未設定なら FORBIDDEN", async () => {
    await expect(call(router.couple.get, undefined, { context: contextFor(null) })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("所属するペアを取得できる", async () => {
    const user = await createUser();
    const created = await call(
      router.couple.create,
      { anniversaryDate: "2020-01-01" },
      { context: contextFor(user) },
    );

    const fetched = await call(router.couple.get, undefined, { context: contextFor(user) });

    expect(fetched).toEqual(created);
  });
});

describe("couple.update", () => {
  it("所属するペアの付き合った日を更新できる", async () => {
    const user = await createUser();
    await call(router.couple.create, { anniversaryDate: "2020-01-01" }, { context: contextFor(user) });

    const updated = await call(
      router.couple.update,
      { anniversaryDate: "2022-02-02" },
      { context: contextFor(user) },
    );

    expect(updated.anniversaryDate).toBe("2022-02-02");
  });

  it("ペアに未所属なら NEEDS_ONBOARDING", async () => {
    const user = await createUser();

    await expect(
      call(router.couple.update, { anniversaryDate: "2022-02-02" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  // 005: writeProcedure が mode === 'readonly'（未認証）を一律 FORBIDDEN にする。
  // DEMO_COUPLE_ID の設定有無に関係ない（test/authorization.test.ts の2番目の項目）
  it("未認証なら FORBIDDEN", async () => {
    await expect(
      call(router.couple.update, { anniversaryDate: "2022-02-02" }, { context: contextFor(null) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

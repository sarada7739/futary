import { env } from "cloudflare:test";
import { call, isProcedure } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

// docs/tasks/005-authorization-middleware.md / security-requirements.md 3節の
// 「認可を触った全てのタスクで維持される」5項目。今後 post/reaction/event 等が
// readProcedure/writeProcedure に載るたびに、このファイルの構造を踏襲して
// 5項目を確認する

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
  demoCoupleId: string | null = null,
): RpcContext {
  return { db, user: user ? { ...user, image: null } : null, ip: "203.0.113.1", demoCoupleId };
}

async function createCouple(
  user: { id: string; name: string; email: string },
  anniversaryDate = "2020-01-01",
) {
  return call(router.couple.create, { anniversaryDate }, { context: contextFor(user) });
}

// couple.get が SELECT できるよう、is_demo=1 の couples 行を直接作る
// （デモペアを作る 014 はまだ実装されていないため、テストのセットアップとして用意する）
async function createDemoCouple(): Promise<string> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT INTO couples (id, anniversary_date, is_demo, created_at) VALUES (?1, '2019-01-01', 1, ?2)",
    )
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
    expect(fetched.anniversaryDate).toBe("2020-01-01");
  });

  it("couple.update は自分の所属ペアしか変更できず、他ペアのレコードは変わらない", async () => {
    const userA = await createUser();
    await createCouple(userA, "2020-01-01");
    const userB = await createUser();
    const coupleB = await createCouple(userB, "2021-01-01");

    await call(
      router.couple.update,
      { anniversaryDate: "2022-02-02" },
      { context: contextFor(userA) },
    );

    const bAfter = await call(router.couple.get, undefined, { context: contextFor(userB) });
    expect(bAfter.anniversaryDate).toBe(coupleB.anniversaryDate);
    expect(bAfter.anniversaryDate).not.toBe("2022-02-02");
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
        { anniversaryDate: "2022-02-02" },
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
});

describe("3. 未認証アクセスで読み取れるのがデモペアのデータのみである", () => {
  it("couple.get は DEMO_COUPLE_ID のペアを返す。他ペアのデータは混ざらない", async () => {
    const demoCoupleId = await createDemoCouple();
    const owner = await createUser();
    await createCouple(owner, "2020-01-01");

    const result = await call(router.couple.get, undefined, { context: contextFor(null, demoCoupleId) });

    expect(result.id).toBe(demoCoupleId);
    expect(result.anniversaryDate).toBe("2019-01-01");
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
      call(router.couple.update, { anniversaryDate: "2022-02-02" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("invite.issue", async () => {
    const user = await createUser();
    await expect(call(router.invite.issue, undefined, { context: contextFor(user) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
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
  it("許可リストに無い手続きは、ミドルウェアが1つ以上適用されている", () => {
    const procedures = collectProcedures(router);
    // 空配列だと以下のループが何もチェックせず成功してしまうため、実在数を保証する
    expect(procedures.length).toBeGreaterThanOrEqual(7);

    for (const { path, procedure } of procedures) {
      if (ALLOWED_WITHOUT_BASE.has(path)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const middlewares = (procedure as any)["~orpc"].middlewares as readonly unknown[];
      expect(middlewares.length, `${path} が認可の基底を経由していません`).toBeGreaterThan(0);
    }
  });

  it("許可リストの手続きが実際に router 上に存在する（リネーム・削除で空文字チェックにならないように）", () => {
    const paths = new Set(collectProcedures(router).map((p) => p.path));
    for (const allowed of ALLOWED_WITHOUT_BASE) {
      expect(paths.has(allowed), `${allowed} が router に存在しません`).toBe(true);
    }
  });
});

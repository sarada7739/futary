import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { addDays, todayJst, yearsBefore } from "@futary/date";
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
  return {
    db,
    bucket,
    r2Sign,
    user: user ? { ...user, image: null } : null,
    ip,
    demoCoupleId,
    sessionCreatedAt: user ? new Date() : null,
    authSecret: "test-secret",
  };
}

// 023: couple.createは日付を一切受け取らない（答えられない質問を必須にしない）
describe("couple.create", () => {
  it("認証済みユーザーがペアを作成し、自分がスロット1で参加する。datingDateはnull", async () => {
    const user = await createUser();

    const couple = await call(router.couple.create, {}, { context: contextFor(user) });

    expect(couple.datingDate).toBeNull();
    expect(couple.marriedDate).toBeNull();
    expect(couple.primaryDate).toBe("dating");

    const member = await db
      .prepare("SELECT slot FROM couple_members WHERE couple_id = ?1 AND user_id = ?2")
      .bind(couple.id, user.id)
      .first<{ slot: number }>();
    expect(member?.slot).toBe(1);
  });

  it("未認証なら FORBIDDEN", async () => {
    await expect(call(router.couple.create, {}, { context: contextFor(null) })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("既に別のペアに所属しているユーザーは作成できない（1人1ペアの制約）", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    await expect(call(router.couple.create, {}, { context: contextFor(user) })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
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
    const created = await call(router.couple.create, {}, { context: contextFor(user) });

    const fetched = await call(router.couple.get, undefined, { context: contextFor(user) });

    expect(fetched).toEqual(created);
  });
});

describe("couple.update", () => {
  it("所属するペアの付き合った日を更新できる", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    const updated = await call(
      router.couple.update,
      { datingDate: "2022-02-02", marriedDate: null, primaryDate: "dating" },
      { context: contextFor(user) },
    );

    expect(updated.datingDate).toBe("2022-02-02");
  });

  it("ペアに未所属なら NEEDS_ONBOARDING", async () => {
    const user = await createUser();

    await expect(
      call(
        router.couple.update,
        { datingDate: "2022-02-02", marriedDate: null, primaryDate: "dating" },
        { context: contextFor(user) },
      ),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  // 005: writeProcedure が mode === 'readonly'（未認証）を一律 FORBIDDEN にする。
  // DEMO_COUPLE_ID の設定有無に関係ない（test/authorization.test.ts の2番目の項目）
  it("未認証なら FORBIDDEN", async () => {
    await expect(
      call(
        router.couple.update,
        { datingDate: "2022-02-02", marriedDate: null, primaryDate: "dating" },
        { context: contextFor(null) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // 023の要望本体: 付き合った日を覚えていない人が、結婚した日だけ設定できること
  it("datingDateをnullのまま、marriedDateだけ設定できる", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    const updated = await call(
      router.couple.update,
      { datingDate: null, marriedDate: "2023-05-01", primaryDate: "married" },
      { context: contextFor(user) },
    );

    expect(updated.datingDate).toBeNull();
    expect(updated.marriedDate).toBe("2023-05-01");
  });

  it("datingDateをnullからnullのまま更新できる（名前だけ変える等の想定）", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    const updated = await call(
      router.couple.update,
      { datingDate: null, marriedDate: null, primaryDate: "dating" },
      { context: contextFor(user) },
    );

    expect(updated.datingDate).toBeNull();
  });
});

// datingDateの日付形式・範囲検証（旧couple.createのテストをcouple.updateへ移設。
// 023でdatingDateはcreateではなくupdateでしか受け取らなくなったため）
describe("couple.update のdatingDate検証", () => {
  it("不正な日付形式は入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    await expect(
      call(
        router.couple.update,
        { datingDate: "2020/01/01", marriedDate: null, primaryDate: "dating" },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  it("極端に先の日付は入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    await expect(
      call(
        router.couple.update,
        { datingDate: "9999-01-01", marriedDate: null, primaryDate: "dating" },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  // L66（Aの決定）: 人間が「記念日が未来の日付なら『あと○日』を出す」と決めたため、
  // 未来の記念日を登録できる必要がある。上限は「1年後まで」（打ち間違いの歯止め。
  // 業務上の意味は無い）。この境界を上下両方でテストする
  it("近い未来（1ヶ月後）の記念日は登録できる（012: upcoming に到達させるため）", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });
    const nearFuture = addDays(todayJst(), 30);

    const updated = await call(
      router.couple.update,
      { datingDate: nearFuture, marriedDate: null, primaryDate: "dating" },
      { context: contextFor(user) },
    );

    expect(updated.datingDate).toBe(nearFuture);
  });

  it("ちょうど1年後の記念日は登録できる（上限の境界）", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });
    const oneYearLater = yearsBefore(todayJst(), -1);

    const updated = await call(
      router.couple.update,
      { datingDate: oneYearLater, marriedDate: null, primaryDate: "dating" },
      { context: contextFor(user) },
    );

    expect(updated.datingDate).toBe(oneYearLater);
  });

  it("1年より先（1年後+1日）の記念日は入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });
    const beyondOneYear = addDays(yearsBefore(todayJst(), -1), 1);

    await expect(
      call(
        router.couple.update,
        { datingDate: beyondOneYear, marriedDate: null, primaryDate: "dating" },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  it("範囲外に古い日付は入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    await expect(
      call(
        router.couple.update,
        { datingDate: "1899-12-31", marriedDate: null, primaryDate: "dating" },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });
});

describe("couple.update のmarried_date・primary_date検証（019）", () => {
  it("primaryDate='married'なのにmarriedDateが無いと入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    await expect(
      call(
        router.couple.update,
        { datingDate: "2020-01-01", marriedDate: null, primaryDate: "married" },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  it("primaryDate='married'かつmarriedDateがあれば更新できる", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    const updated = await call(
      router.couple.update,
      { datingDate: "2020-01-01", marriedDate: "2023-05-01", primaryDate: "married" },
      { context: contextFor(user) },
    );

    expect(updated.marriedDate).toBe("2023-05-01");
    expect(updated.primaryDate).toBe("married");
  });

  it("marriedDateがdatingDateより前だと入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    await expect(
      call(
        router.couple.update,
        { datingDate: "2020-01-01", marriedDate: "2019-12-31", primaryDate: "married" },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  it("marriedDateとdatingDateが同日なら更新できる（境界）", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    const updated = await call(
      router.couple.update,
      { datingDate: "2020-01-01", marriedDate: "2020-01-01", primaryDate: "married" },
      { context: contextFor(user) },
    );

    expect(updated.marriedDate).toBe("2020-01-01");
  });

  it("primaryDate='none'にできる（非表示）", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    const updated = await call(
      router.couple.update,
      { datingDate: "2020-01-01", marriedDate: null, primaryDate: "none" },
      { context: contextFor(user) },
    );

    expect(updated.primaryDate).toBe("none");
  });

  it("不正なprimaryDateの値は入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await call(router.couple.create, {}, { context: contextFor(user) });

    await expect(
      call(
        router.couple.update,
        // @ts-expect-error 契約はz.enum(PRIMARY_DATE_VALUES)固定。不正な値をわざと渡す
        { datingDate: "2020-01-01", marriedDate: null, primaryDate: "single" },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });
});

// Rレビュー指摘: 上のdescribeはすべてZodのrefineを経由しており、DBのTRIGGER
// （couples_married_date_required_insert/update。packages/db/src/schema/couple.ts）
// が実際に効いているかを検証していなかった。TRIGGERが消えても壊れても全部緑に
// なりうる状態だったため、Zodを経由せず`couples`へ直接INSERT/UPDATEして確かめる
// （018の重複解消テストと同じ形）。シードのような入力スキーマを通らない
// 書き込み口を想定したTRIGGERである以上、この検証には意味がある
describe("couplesのTRIGGER（DB側の不変条件を直接確かめる）", () => {
  it("INSERTでprimary_date='married'かつmarried_dateがNULLだと弾かれる", async () => {
    await expect(
      db
        .prepare(
          "INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (?1, '2020-01-01', NULL, 'married', 0, 0)",
        )
        .bind(crypto.randomUUID())
        .run(),
    ).rejects.toThrow(/constraint failed/i);
  });

  it("UPDATEでprimary_date='dating'から'married'へ変えようとし、married_dateがNULLのままだと弾かれる", async () => {
    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (?1, '2020-01-01', NULL, 'dating', 0, 0)",
      )
      .bind(id)
      .run();

    await expect(
      db.prepare("UPDATE couples SET primary_date = 'married' WHERE id = ?1").bind(id).run(),
    ).rejects.toThrow(/constraint failed/i);

    const row = await db
      .prepare("SELECT primary_date FROM couples WHERE id = ?1")
      .bind(id)
      .first<{ primary_date: string }>();
    expect(row?.primary_date).toBe("dating");
  });

  it("married行のmarried_dateを後からNULLに落とそうとすると弾かれる（UPDATE側のTRIGGERが無いと通ってしまう経路）", async () => {
    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (?1, '2020-01-01', '2022-01-01', 'married', 0, 0)",
      )
      .bind(id)
      .run();

    await expect(
      db.prepare("UPDATE couples SET married_date = NULL WHERE id = ?1").bind(id).run(),
    ).rejects.toThrow(/constraint failed/i);
  });

  // 019・Aの決定（PR #123タスク定義の更新）: married_dateがdating_dateより
  // 前にならない制約も、married_date_required と同じ理由（シードは入力スキーマを
  // 通らない書き込み口）でDB側にも表す
  it("INSERTでmarried_dateがdating_dateより前だと弾かれる", async () => {
    await expect(
      db
        .prepare(
          "INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (?1, '2020-01-01', '2019-12-31', 'dating', 0, 0)",
        )
        .bind(crypto.randomUUID())
        .run(),
    ).rejects.toThrow(/constraint failed/i);
  });

  it("UPDATEでmarried_dateをdating_dateより前の日付に変えようとすると弾かれる", async () => {
    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (?1, '2020-01-01', NULL, 'dating', 0, 0)",
      )
      .bind(id)
      .run();

    await expect(
      db.prepare("UPDATE couples SET married_date = '2019-12-31' WHERE id = ?1").bind(id).run(),
    ).rejects.toThrow(/constraint failed/i);
  });

  it("married_dateとdating_dateが同日ならDB側でも許される（境界）", async () => {
    const id = crypto.randomUUID();
    await expect(
      db
        .prepare(
          "INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (?1, '2020-01-01', '2020-01-01', 'married', 0, 0)",
        )
        .bind(id)
        .run(),
    ).resolves.not.toThrow();
  });

  // 023: dating_dateがNULL（まだ設定していない）でも、married_dateだけは
  // DB側でも設定できる（比較しようがないため通す。TRIGGERのWHEN句の判断）
  it("INSERTでdating_dateがNULLでもmarried_dateを設定できる", async () => {
    await expect(
      db
        .prepare(
          "INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (?1, NULL, '2021-01-01', 'married', 0, 0)",
        )
        .bind(crypto.randomUUID())
        .run(),
    ).resolves.not.toThrow();
  });
});

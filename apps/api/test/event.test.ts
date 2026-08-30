import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

// post.test.ts と同じ理由（実際の R2 API トークンの設定有無にテストの合否を左右させない）
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
  return { db, bucket, r2Sign, user: user ? { ...user, image: null } : null, ip: "203.0.113.1", demoCoupleId };
}

async function createCouple(user: { id: string; name: string; email: string }) {
  return call(router.couple.create, { anniversaryDate: "2020-01-01" }, { context: contextFor(user) });
}

async function createEvent(
  user: { id: string; name: string; email: string },
  overrides: Partial<{
    date: string;
    title: string;
    kind: "anniversary" | "plan" | "meetup";
    repeatYearly: boolean;
    time: string | null;
    isShared: boolean;
  }> = {},
) {
  return call(
    router.event.create,
    {
      date: overrides.date ?? "2020-01-15",
      title: overrides.title ?? "テストイベント",
      kind: overrides.kind ?? "plan",
      repeatYearly: overrides.repeatYearly ?? false,
      time: overrides.time,
      isShared: overrides.isShared ?? false,
    },
    { context: contextFor(user) },
  );
}

describe("event.create / event.list（基本のCRUD）", () => {
  it("作成した予定・会った日がそのまま一覧に出る（repeatYearly=false は射影しない）", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createEvent(user, { date: "2026-03-10", title: "水族館デート", kind: "meetup" });

    const result = await call(
      router.event.list,
      { from: "2026-03-01", to: "2026-03-31" },
      { context: contextFor(user) },
    );

    expect(result.items).toEqual([
      {
        id: created.id,
        date: "2026-03-10",
        sourceDate: "2026-03-10",
        title: "水族館デート",
        kind: "meetup",
        repeatYearly: false,
        time: null,
        createdByName: user.name,
        isShared: false,
        canEdit: true,
      },
    ]);
  });

  // L67（Aの決定）: repeatYearlyはkind='anniversary'のときだけtrueにできる。
  // 入力スキーマで拒否する（DBのCHECK制約は置かない）
  it("kind='meetup'にrepeatYearly:trueを指定すると入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(
        router.event.create,
        { date: "2026-03-10", title: "会った日", kind: "meetup", repeatYearly: true, isShared: false },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  it("kind='plan'にrepeatYearly:trueを指定すると入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(
        router.event.create,
        { date: "2026-03-10", title: "予定", kind: "plan", repeatYearly: true, isShared: false },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  it("kind='anniversary'にrepeatYearly:trueは登録できる", async () => {
    const user = await createUser();
    await createCouple(user);

    const created = await call(
      router.event.create,
      { date: "2026-03-10", title: "記念日", kind: "anniversary", repeatYearly: true, isShared: false },
      { context: contextFor(user) },
    );

    expect(created.repeatYearly).toBe(true);
  });

  it("範囲外の一回きりの予定は返らない", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2026-03-10", kind: "plan" });

    const result = await call(
      router.event.list,
      { from: "2026-04-01", to: "2026-04-30" },
      { context: contextFor(user) },
    );

    expect(result.items).toHaveLength(0);
  });

  it("他ペアのイベントは一覧に混ざらない", async () => {
    const userA = await createUser();
    await createCouple(userA);
    await createEvent(userA, { date: "2026-03-10", title: "Aの予定" });

    const userB = await createUser();
    await createCouple(userB);
    await createEvent(userB, { date: "2026-03-10", title: "Bの予定" });

    const result = await call(
      router.event.list,
      { from: "2026-03-01", to: "2026-03-31" },
      { context: contextFor(userA) },
    );

    expect(result.items.map((e) => e.title)).toEqual(["Aの予定"]);
  });
});

describe("event.update / event.delete", () => {
  it("自分のペアのイベントを更新できる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createEvent(user, { date: "2026-03-10", title: "元のタイトル" });

    const updated = await call(
      router.event.update,
      { id: created.id, date: "2026-03-11", title: "変更後のタイトル", kind: "meetup", repeatYearly: false, isShared: false },
      { context: contextFor(user) },
    );

    expect(updated).toEqual({
      id: created.id,
      date: "2026-03-11",
      sourceDate: "2026-03-11",
      title: "変更後のタイトル",
      kind: "meetup",
      repeatYearly: false,
      time: null,
      createdByName: user.name,
      isShared: false,
      canEdit: true,
    });
  });

  it("更新でもkind='meetup'にrepeatYearly:trueを指定すると入力バリデーションで弾かれる（L67）", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createEvent(user, { date: "2026-03-10", kind: "meetup" });

    await expect(
      call(
        router.event.update,
        { id: created.id, date: "2026-03-10", title: "会った日", kind: "meetup", repeatYearly: true, isShared: false },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  it("他ペアのイベントIDを指定した更新は NOT_FOUND になり、対象は変わらない", async () => {
    const userA = await createUser();
    await createCouple(userA);
    const eventA = await createEvent(userA, { title: "Aの予定" });

    const userB = await createUser();
    await createCouple(userB);

    await expect(
      call(
        router.event.update,
        { id: eventA.id, date: "2099-01-01", title: "改ざん", kind: "plan", repeatYearly: false, isShared: false },
        { context: contextFor(userB) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT title FROM events WHERE id = ?1").bind(eventA.id).first<{ title: string }>();
    expect(row?.title).toBe("Aの予定");
  });

  it("存在しないIDの更新は NOT_FOUND", async () => {
    const user = await createUser();
    await createCouple(user);
    await expect(
      call(
        router.event.update,
        { id: crypto.randomUUID(), date: "2026-01-01", title: "存在しない", kind: "plan", repeatYearly: false, isShared: false },
        { context: contextFor(user) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("自分のペアのイベントを削除できる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createEvent(user);

    const result = await call(router.event.delete, { id: created.id }, { context: contextFor(user) });
    expect(result.id).toBe(created.id);

    const row = await db.prepare("SELECT id FROM events WHERE id = ?1").bind(created.id).first();
    expect(row).toBeNull();
  });

  it("他ペアのイベントIDを指定した削除は NOT_FOUND になり、対象は消えない", async () => {
    const userA = await createUser();
    await createCouple(userA);
    const eventA = await createEvent(userA);

    const userB = await createUser();
    await createCouple(userB);

    await expect(
      call(router.event.delete, { id: eventA.id }, { context: contextFor(userB) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await db.prepare("SELECT id FROM events WHERE id = ?1").bind(eventA.id).first();
    expect(row).not.toBeNull();
  });
});

// 021: canEditはSQLのWHERE句とは別の言語（TypeScript）で計算される。
// 「両方に同じことを書いた」ではなく「両方が同じ答えを出す」ことを固定する
// （docs/tasks/021-plan-ownership.md）。組み合わせはkind3値×isShared2値×
// 設定者かどうか2値の8通りだが、isSharedはkind='plan'のときしか立てられない
// ため、anniversary/meetup×isShared=trueは作れない組み合わせとして除外する
// （Rレビュー指摘: 作れない組み合わせを数えて「一致した」と主張しない）
describe("021: event.list の canEdit と、event.update/delete の実際の可否が一致する", () => {
  type Case = {
    kind: "anniversary" | "plan" | "meetup";
    isShared: boolean;
    viewerIsOwner: boolean;
    expectedCanEdit: boolean;
  };

  const cases: Case[] = [
    { kind: "anniversary", isShared: false, viewerIsOwner: true, expectedCanEdit: true },
    { kind: "anniversary", isShared: false, viewerIsOwner: false, expectedCanEdit: true },
    { kind: "meetup", isShared: false, viewerIsOwner: true, expectedCanEdit: true },
    { kind: "meetup", isShared: false, viewerIsOwner: false, expectedCanEdit: true },
    { kind: "plan", isShared: false, viewerIsOwner: true, expectedCanEdit: true },
    { kind: "plan", isShared: false, viewerIsOwner: false, expectedCanEdit: false },
    { kind: "plan", isShared: true, viewerIsOwner: true, expectedCanEdit: true },
    { kind: "plan", isShared: true, viewerIsOwner: false, expectedCanEdit: true },
  ];

  it.each(cases)(
    "kind=$kind isShared=$isShared 設定者が見る=$viewerIsOwner → canEdit=$expectedCanEdit",
    async ({ kind, isShared, viewerIsOwner, expectedCanEdit }) => {
      const owner = await createUser();
      await createCouple(owner);
      const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
      const partner = await createUser();
      await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
      const viewer = viewerIsOwner ? owner : partner;
      const repeatYearly = kind === "anniversary";

      const created = await createEvent(owner, { date: "2026-06-01", kind, isShared, repeatYearly });

      // event.list が返す canEdit
      const listResult = await call(
        router.event.list,
        { from: "2026-06-01", to: "2026-06-01" },
        { context: contextFor(viewer) },
      );
      const listedEvent = listResult.items.find((e) => e.id === created.id);
      expect(listedEvent?.canEdit).toBe(expectedCanEdit);

      // event.update の実際の可否
      const updateInput = {
        id: created.id,
        date: "2026-06-01",
        title: "更新後",
        kind,
        repeatYearly,
        isShared,
      };
      if (expectedCanEdit) {
        const updated = await call(router.event.update, updateInput, { context: contextFor(viewer) });
        expect(updated.title).toBe("更新後");
      } else {
        await expect(
          call(router.event.update, updateInput, { context: contextFor(viewer) }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }

      // event.delete の実際の可否（updateで状態が変わった対象とは別のイベントで検証）
      const forDelete = await createEvent(owner, { date: "2026-06-02", kind, isShared, repeatYearly });
      if (expectedCanEdit) {
        const deleted = await call(router.event.delete, { id: forDelete.id }, { context: contextFor(viewer) });
        expect(deleted.id).toBe(forDelete.id);
      } else {
        await expect(
          call(router.event.delete, { id: forDelete.id }, { context: contextFor(viewer) }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
    },
  );
});

// architecture.md 5節「繰り返し記念日の射影」。完了条件・タスクファイルの
// 「テストで証明すること」に列挙された観点をそれぞれ1テストずつ対応させる
describe("event.list の繰り返し記念日の射影", () => {
  it("repeat_yearly の記念日が、登録年と異なる年の照会で正しく返る", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2020-05-10", title: "記念日", kind: "anniversary", repeatYearly: true });

    const result = await call(
      router.event.list,
      { from: "2026-05-01", to: "2026-05-31" },
      { context: contextFor(user) },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.date).toBe("2026-05-10");
    expect(result.items[0]?.sourceDate).toBe("2020-05-10");
    expect(result.items[0]?.repeatYearly).toBe(true);
  });

  it("範囲が年をまたぐとき、年末側と年始側の記念日が両方返る", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2020-12-25", title: "年末の記念日", kind: "anniversary", repeatYearly: true });
    await createEvent(user, { date: "2020-01-05", title: "年始の記念日", kind: "anniversary", repeatYearly: true });

    const result = await call(
      router.event.list,
      { from: "2026-12-20", to: "2027-01-10" },
      { context: contextFor(user) },
    );

    expect(result.items.map((e) => e.date).sort()).toEqual(["2026-12-25", "2027-01-05"]);
  });

  it("400日の範囲では同じ記念日が2回返る（重複を除去しない）", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2020-01-15", title: "1月15日の記念日", kind: "anniversary", repeatYearly: true });

    // 2026-01-01 〜 2027-02-05 はちょうど400日（architecture.md 5節の実例）
    const result = await call(
      router.event.list,
      { from: "2026-01-01", to: "2027-02-05" },
      { context: contextFor(user) },
    );

    const matches = result.items.filter((e) => e.title === "1月15日の記念日");
    expect(matches.map((e) => e.date).sort()).toEqual(["2026-01-15", "2027-01-15"]);
  });

  it("3つの暦年に触れる窓では、中間の年の記念日だけが返る（端の年は窓の外）", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2010-06-15", title: "6月15日の記念日", kind: "anniversary", repeatYearly: true });

    // 2026-12-20 〜 2028-01-24 はちょうど400日で2026・2027・2028の3年に触れる
    // （architecture.md 5節の実例）。06-15 は 2027-06-15 だけが窓に入る
    const result = await call(
      router.event.list,
      { from: "2026-12-20", to: "2028-01-24" },
      { context: contextFor(user) },
    );

    const matches = result.items.filter((e) => e.title === "6月15日の記念日");
    expect(matches.map((e) => e.date)).toEqual(["2027-06-15"]);
  });

  it("401日の範囲は INVALID_INPUT", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.event.list, { from: "2026-01-01", to: "2027-02-06" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("from が to より後だと INVALID_INPUT", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.event.list, { from: "2026-02-01", to: "2026-01-01" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("うるう年 02-29 の記念日は、平年に射影すると 02-28 に出る（消えない）", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2024-02-29", title: "うるう日の記念日", kind: "anniversary", repeatYearly: true });

    const result = await call(
      router.event.list,
      { from: "2026-02-01", to: "2026-02-28" },
      { context: contextFor(user) },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.date).toBe("2026-02-28");
    expect(result.items[0]?.sourceDate).toBe("2024-02-29");
  });

  it("うるう年へ射影したときは 02-29 のまま", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2024-02-29", title: "うるう日の記念日", kind: "anniversary", repeatYearly: true });

    const result = await call(
      router.event.list,
      { from: "2028-02-01", to: "2028-02-29" },
      { context: contextFor(user) },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.date).toBe("2028-02-29");
  });
});

// 018: 設定者の名前・時間・会った日の一意化
describe("event.create / event.update の time（018）", () => {
  it("anniversaryにtimeを付けるとINVALID_INPUTになる", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(
        router.event.create,
        { date: "2026-03-10", title: "記念日", kind: "anniversary", repeatYearly: true, time: "10:00", isShared: false },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  it("更新でもanniversaryにtimeを付けるとINVALID_INPUTになる", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createEvent(user, { kind: "anniversary", repeatYearly: true });

    await expect(
      call(
        router.event.update,
        {
          id: created.id,
          date: "2026-03-10",
          title: "記念日",
          kind: "anniversary",
          repeatYearly: true,
          time: "10:00",
          isShared: false,
        },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  it("planにはtimeを設定できる。省略するとnullで作れる", async () => {
    const user = await createUser();
    await createCouple(user);

    const withTime = await createEvent(user, { kind: "plan", time: "18:30" });
    expect(withTime.time).toBe("18:30");

    const withoutTime = await createEvent(user, { date: "2020-01-16", kind: "plan" });
    expect(withoutTime.time).toBeNull();
  });

  it("不正な形式のtimeはINVALID_INPUTになる", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(
        router.event.create,
        { date: "2026-03-10", title: "予定", kind: "plan", repeatYearly: false, time: "25:00", isShared: false },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });
});

describe("event.create / event.list の createdByName（018）", () => {
  it("event.createの結果とevent.listの両方に設定者の名前が出る", async () => {
    const user = await createUser();
    await createCouple(user);
    const created = await createEvent(user, { date: "2026-03-10" });
    expect(created.createdByName).toBe(user.name);

    const result = await call(
      router.event.list,
      { from: "2026-03-01", to: "2026-03-31" },
      { context: contextFor(user) },
    );
    expect(result.items[0]?.createdByName).toBe(user.name);
  });

  // created_by は user(id) への外部キー（ON DELETE no action）であり、D1はFK違反を
  // 常に拒否するため「userが存在しない」状態を実際には作れない（L35・posts.authorNameと
  // 同じ制約。architecture.md 5節）。null許容にしていることはコードとスキーマで担保する
});

describe("「会った日」は1日1件（018）", () => {
  it("同じ日に2件目のmeetupをcreateすると、1件目が上書きされて1件のままになる", async () => {
    const user = await createUser();
    await createCouple(user);
    const first = await createEvent(user, { date: "2026-05-01", kind: "meetup", title: "1件目", time: "10:00" });
    const second = await createEvent(user, { date: "2026-05-01", kind: "meetup", title: "2件目", time: "15:00" });

    expect(second.date).toBe(first.date);
    expect(second.title).toBe("2件目");
    expect(second.time).toBe("15:00");

    const result = await call(
      router.event.list,
      { from: "2026-05-01", to: "2026-05-01" },
      { context: contextFor(user) },
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("2件目");
  });

  it("別の日のmeetupは上書きの影響を受けない", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2026-05-01", kind: "meetup", title: "5/1" });
    await createEvent(user, { date: "2026-05-02", kind: "meetup", title: "5/2" });
    await createEvent(user, { date: "2026-05-01", kind: "meetup", title: "5/1（上書き後）" });

    const result = await call(
      router.event.list,
      { from: "2026-05-01", to: "2026-05-02" },
      { context: contextFor(user) },
    );
    expect(result.items.map((e) => e.title).sort()).toEqual(["5/1（上書き後）", "5/2"]);
  });

  it("meetup以外（plan/anniversary）は同じ日に何件でも作れる（部分UNIQUEの対象外）", async () => {
    const user = await createUser();
    await createCouple(user);
    await createEvent(user, { date: "2026-05-01", kind: "plan", title: "予定1" });
    await createEvent(user, { date: "2026-05-01", kind: "plan", title: "予定2" });

    const result = await call(
      router.event.list,
      { from: "2026-05-01", to: "2026-05-01" },
      { context: contextFor(user) },
    );
    expect(result.items.map((e) => e.title).sort()).toEqual(["予定1", "予定2"]);
  });

  it("event.updateで既にmeetupがある日へ移そうとするとINVALID_INPUTになり、両方とも変わらない", async () => {
    const user = await createUser();
    await createCouple(user);
    const meetupOnDay1 = await createEvent(user, { date: "2026-05-01", kind: "meetup", title: "5/1の会った日" });
    const meetupOnDay2 = await createEvent(user, { date: "2026-05-02", kind: "meetup", title: "5/2の会った日" });

    await expect(
      call(
        router.event.update,
        { id: meetupOnDay2.id, date: "2026-05-01", title: "5/2から移動", kind: "meetup", repeatYearly: false, isShared: false },
        { context: contextFor(user) },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const result = await call(
      router.event.list,
      { from: "2026-05-01", to: "2026-05-02" },
      { context: contextFor(user) },
    );
    expect(result.items.map((e) => e.title).sort()).toEqual(["5/1の会った日", "5/2の会った日"]);
    expect(meetupOnDay1.id).not.toBe(meetupOnDay2.id);
  });

  it("event.updateで自分自身の日付・タイトルを変えずに更新するのは衝突にならない", async () => {
    const user = await createUser();
    await createCouple(user);
    const meetup = await createEvent(user, { date: "2026-05-01", kind: "meetup", title: "元のタイトル" });

    const updated = await call(
      router.event.update,
      { id: meetup.id, date: "2026-05-01", title: "改題", kind: "meetup", repeatYearly: false, isShared: false },
      { context: contextFor(user) },
    );
    expect(updated.title).toBe("改題");
  });
});

// 0008_event_time_and_meetup_unique.sql の重複解消（DELETE文）のロジックを
// 単体で検証する。本番のevents表は部分UNIQUEインデックスが既に有効なため
// 重複データをこの環境で再現できず、マイグレーションSQLそのものを実行する形の
// テストは書けない（実際のマイグレーション適用はローカルD1で手動確認済み。
// worklog.md参照）。同一のDELETE文を使い捨てのテーブルに対して実行し、
// 「最新の1件（created_atが最大、同値ならidが大きい方）が残る」ことだけを検証する
describe("重複したmeetupの解消ロジック（0008マイグレーションと同一のSQL）", () => {
  it("同じcouple_id・dateの複数meetupのうち、最新の1件だけが残る", async () => {
    await db.exec(
      "CREATE TABLE _dedupe_test (id TEXT PRIMARY KEY, couple_id TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL)",
    );
    try {
      await db
        .prepare("INSERT INTO _dedupe_test VALUES (?1, 'c1', '2026-05-01', 'meetup', 100)")
        .bind("old")
        .run();
      await db
        .prepare("INSERT INTO _dedupe_test VALUES (?1, 'c1', '2026-05-01', 'meetup', 200)")
        .bind("new")
        .run();
      await db
        .prepare("INSERT INTO _dedupe_test VALUES (?1, 'c1', '2026-05-02', 'meetup', 100)")
        .bind("other-day")
        .run();
      await db
        .prepare("INSERT INTO _dedupe_test VALUES (?1, 'c1', '2026-05-01', 'plan', 999)")
        .bind("plan-same-day")
        .run();

      await db
        .prepare(
          `DELETE FROM _dedupe_test
            WHERE kind = 'meetup'
              AND id NOT IN (
                SELECT id FROM (
                  SELECT id, ROW_NUMBER() OVER (
                           PARTITION BY couple_id, date
                           ORDER BY created_at DESC, id DESC
                         ) AS rn
                    FROM _dedupe_test
                   WHERE kind = 'meetup'
                )
                WHERE rn = 1
              )`,
        )
        .run();

      const { results } = await db.prepare("SELECT id FROM _dedupe_test ORDER BY id").all<{ id: string }>();
      expect(results.map((r) => r.id).sort()).toEqual(["new", "other-day", "plan-same-day"]);
    } finally {
      await db.exec("DROP TABLE _dedupe_test");
    }
  });

  // created_atが同値のときのタイブレーク（idが大きい方を残す）。Rレビュー指摘。
  // この場合だけ大小が結果を左右するため、created_atに差がある上のテストとは別に確認する
  it("created_atが同値なら、idが大きい方が残る", async () => {
    await db.exec(
      "CREATE TABLE _dedupe_tiebreak_test (id TEXT PRIMARY KEY, couple_id TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL)",
    );
    try {
      await db
        .prepare("INSERT INTO _dedupe_tiebreak_test VALUES ('id-a', 'c1', '2026-05-01', 'meetup', 100)")
        .run();
      await db
        .prepare("INSERT INTO _dedupe_tiebreak_test VALUES ('id-b', 'c1', '2026-05-01', 'meetup', 100)")
        .run();

      await db
        .prepare(
          `DELETE FROM _dedupe_tiebreak_test
            WHERE kind = 'meetup'
              AND id NOT IN (
                SELECT id FROM (
                  SELECT id, ROW_NUMBER() OVER (
                           PARTITION BY couple_id, date
                           ORDER BY created_at DESC, id DESC
                         ) AS rn
                    FROM _dedupe_tiebreak_test
                   WHERE kind = 'meetup'
                )
                WHERE rn = 1
              )`,
        )
        .run();

      const { results } = await db.prepare("SELECT id FROM _dedupe_tiebreak_test").all<{ id: string }>();
      expect(results.map((r) => r.id)).toEqual(["id-b"]);
    } finally {
      await db.exec("DROP TABLE _dedupe_tiebreak_test");
    }
  });
});

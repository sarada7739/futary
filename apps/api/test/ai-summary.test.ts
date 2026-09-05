import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { currentMonthJst, currentWeekJst, jstMonthRangeMs, jstWeekRangeMs } from "@futary/date";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

// 037タスク定義「テストで本物のAPIを叩かない」。
//
// 【事故と訂正】最初 vi.mock("../src/lib/ai", ...) でgenerateSummaryを
// 差し替えようとしたが、このテストは@cloudflare/vitest-plugin（Miniflare/
// workerd上でテストコード自体を実行する）を使っており、vi.mockによる
// ESMモジュールの差し替えが効かず、実際にhttps://api.openai.com へ本物の
// リクエストが飛んだ（テスト用の偽キーのため401で失敗し、生成には成功して
// いない＝費用は発生していないはずだが、叩いてはいけないものを実際に
// 叩いてしまった）。
//
// generateSummaryはグローバルのfetchを直接呼ぶ実装のため、vi.stubGlobalで
// fetch自体を差し替える形に直した。モジュール境界に依存せず、テストコードと
// procedure実行が同じグローバルスコープ（同じworkerdアイソレート）を
// 共有していることを利用する
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string | URL) => {
    const href = url.toString();
    if (href.includes("openai.com")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "テストのAIまとめ本文" } }] }), {
        status: 200,
      });
    }
    if (href.includes("anthropic.com")) {
      return new Response(JSON.stringify({ content: [{ text: "テストのAIまとめ本文" }] }), { status: 200 });
    }
    throw new Error(`想定外のURLへのfetch: ${href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

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
    aiEnv: { provider: "openai", openaiApiKey: "test-openai-key" },
    user: user ? { ...user, image: null } : null,
    ip: "203.0.113.1",
    demoCoupleId,
    sessionCreatedAt: user ? Date.now() : null,
    authSecret: "test-secret",
  };
}

async function createCoupleOfTwo(optInBoth = true) {
  const owner = await createUser();
  const couple = await call(router.couple.create, {}, { context: contextFor(owner) });
  const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
  const partner = await createUser();
  await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
  if (optInBoth) {
    await call(router.me.setAiOptIn, { optIn: true }, { context: contextFor(owner) });
    await call(router.me.setAiOptIn, { optIn: true }, { context: contextFor(partner) });
  }
  return { owner, partner, couple };
}

function rangeFor(periodKind: "month" | "week", periodKey: string) {
  return periodKind === "month" ? jstMonthRangeMs(periodKey) : jstWeekRangeMs(periodKey);
}

async function createPosts(
  user: { id: string; name: string; email: string },
  count: number,
  periodKind: "month" | "week",
  periodKey: string,
) {
  // created_atを直接書き込む（post.createはDate.now()を使うため、過去の
  // 期間のデータはSQLで直接作る）。couple_idはpost.createで作られた行から引く
  const couple = await call(router.couple.get, undefined, { context: contextFor(user) });
  const { fromMs } = rangeFor(periodKind, periodKey);
  const baseSeconds = Math.floor(fromMs / 1000) + 3600;
  for (let i = 0; i < count; i++) {
    await db
      .prepare("INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(crypto.randomUUID(), couple.id, user.id, `テスト投稿${i}`, baseSeconds + i * 60)
      .run();
  }
}

// currentMonthJst/currentWeekJstより確実に過去になる固定値
// （2026-01・2025-W20は現在（テスト実行時点で2026-09以降）より前）。
// PAST_WEEKはPAST_MONTHと同じ月にならないようにする（同じ月にすると、
// 「月の投稿が3件未満」を確かめるテストで週用に作った投稿まで月の範囲に
// 入り込み、実際には3件以上になってしまう。実測して発覚した）
const PAST_MONTH = "2026-01";
const PAST_WEEK = "2025-W20";

describe("aiSummary.generate（ADR-013の同意・費用の歯止め）", () => {
  it("2人とも同意していれば月次を生成できる", async () => {
    const { owner } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);

    const result = await call(
      router.aiSummary.generate,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.generatedCount).toBe(1);
    expect(result.body).toBe("テストのAIまとめ本文");
    // 実際にfetchが呼ばれたこと自体は確認する（差し替えが効いていることの検査。
    // 宛先がopenai.comであることも合わせて見る）
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]?.toString()).toContain("openai.com");
  });

  it("2人とも同意していれば週次も生成できる", async () => {
    const { owner } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "week", PAST_WEEK);

    const result = await call(
      router.aiSummary.generate,
      { periodKind: "week", periodKey: PAST_WEEK },
      { context: contextFor(owner) },
    );
    expect(result.generatedCount).toBe(1);
    expect(result.body).toBe("テストのAIまとめ本文");
  });

  it("片方だけ同意していてもFORBIDDEN", async () => {
    const owner = await createUser();
    await call(router.couple.create, {}, { context: contextFor(owner) });
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
    await call(router.me.setAiOptIn, { optIn: true }, { context: contextFor(owner) });
    // partnerは同意していない
    await createPosts(owner, 3, "month", PAST_MONTH);

    await expect(
      call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("2人とも同意していなくてもFORBIDDEN", async () => {
    const { owner } = await createCoupleOfTwo(false);
    await createPosts(owner, 3, "month", PAST_MONTH);

    await expect(
      call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // タスク定義1節「1人のペアでは使えない（相手がまだ居ないので同意が取れない）」
  it("1人のペアではFORBIDDEN（同意していても）", async () => {
    const owner = await createUser();
    await call(router.couple.create, {}, { context: contextFor(owner) });
    await call(router.me.setAiOptIn, { optIn: true }, { context: contextFor(owner) });
    await createPosts(owner, 3, "month", PAST_MONTH);

    await expect(
      call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("未認証（デモ）はFORBIDDEN", async () => {
    const { owner, couple } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);
    await db.prepare("UPDATE couples SET is_demo = 1 WHERE id = ?1").bind(couple.id).run();

    await expect(
      call(
        router.aiSummary.generate,
        { periodKind: "month", periodKey: PAST_MONTH },
        { context: contextFor(null, couple.id) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // security-auditor指摘（Low）: 認証済みの利用者がis_demoのペアに
  // 所属している、という実際には起こりえない組み合わせを直接作って、
  // 手続き自身の防御を確認する（me.test.tsの
  // 「is_demoのペアからは削除できない（手続き自身でも拒む）」と同じ形）
  it("認証済みでもis_demoのペアからは生成できない（手続き自身でも拒む）", async () => {
    const { owner, couple } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);
    await db.prepare("UPDATE couples SET is_demo = 1 WHERE id = ?1").bind(couple.id).run();

    await expect(
      call(
        router.aiSummary.generate,
        { periodKind: "month", periodKey: PAST_MONTH },
        { context: contextFor(owner) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("投稿が3件未満の月・週はINVALID_INPUT（基準は同じ）", async () => {
    const { owner } = await createCoupleOfTwo(true);
    await createPosts(owner, 2, "month", PAST_MONTH);
    await createPosts(owner, 2, "week", PAST_WEEK);

    await expect(
      call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      call(router.aiSummary.generate, { periodKind: "week", periodKey: PAST_WEEK }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("未来の月・週はINVALID_INPUT", async () => {
    const { owner } = await createCoupleOfTwo(true);
    const [y] = currentMonthJst().split("-");
    const futureMonth = `${Number(y) + 1}-01`;

    await expect(
      call(router.aiSummary.generate, { periodKind: "month", periodKey: futureMonth }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      call(router.aiSummary.generate, { periodKind: "week", periodKey: "2099-W01" }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  // タスク定義9節「今月・今週も終わっていないので拒む」
  it("今月・今週もINVALID_INPUT（未来だけでなく進行中の期間も拒む）", async () => {
    const { owner } = await createCoupleOfTwo(true);

    await expect(
      call(
        router.aiSummary.generate,
        { periodKind: "month", periodKey: currentMonthJst() },
        { context: contextFor(owner) },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      call(
        router.aiSummary.generate,
        { periodKind: "week", periodKey: currentWeekJst() },
        { context: contextFor(owner) },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("同じ期間に3回までは生成でき、4回目はLIMIT_REACHED（回数は増えない）", async () => {
    const { owner, couple } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);

    const first = await call(
      router.aiSummary.generate,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );
    expect(first.generatedCount).toBe(1);
    const second = await call(
      router.aiSummary.generate,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );
    expect(second.generatedCount).toBe(2);
    const third = await call(
      router.aiSummary.generate,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );
    expect(third.generatedCount).toBe(3);

    await expect(
      call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "LIMIT_REACHED" });

    // 4回目の失敗でgenerated_countが増えていないこと（確認観点「生成に失敗した
    // とき、回数が減っていないか」の裏側。4回目はそもそもAPIを呼ばないため
    // 増えないはずだが、DBの値で直接確認する）
    const row = await db
      .prepare("SELECT generated_count FROM ai_summaries WHERE couple_id = ?1 AND period_kind = 'month' AND period_key = ?2")
      .bind(couple.id, PAST_MONTH)
      .first<{ generated_count: number }>();
    expect(row?.generated_count).toBe(3);
  });

  // security-auditor指摘（Medium）: 期間ごとの歯止めが check-then-act
  // だと、同じ期間へ並行にgenerateを投げたときにすり抜ける
  // （全部が同じgenerated_countを読んで通過し、N回API呼び出しが発生する
  // のにDB上は1回分しか記録されない）。1文の条件付きUPSERT
  // （ON CONFLICT DO UPDATE ... WHERE generated_count < 3）に直した後、
  // 実際に並行リクエストを投げても、成功が3回ちょうど・DBの値も3ちょうどに
  // なることを確認する
  it("同じ期間へ並行にgenerateを投げても、成功は3回までに収まる（レース対策）", async () => {
    const { owner, couple } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);

    const attempts = 6;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        call(
          router.aiSummary.generate,
          { periodKind: "month", periodKey: PAST_MONTH },
          { context: contextFor(owner) },
        ),
      ),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(3);
    expect(failed).toHaveLength(attempts - 3);
    for (const r of failed) {
      if (r.status === "rejected") {
        expect(r.reason).toMatchObject({ code: "LIMIT_REACHED" });
      }
    }

    // 成功した3回の生成回数が重複なく1・2・3になっている
    // （同じ番号を2つのリクエストが同時に取っていない）
    const generatedCounts = succeeded
      .map((r) => (r.status === "fulfilled" ? r.value.generatedCount : null))
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(generatedCounts).toEqual([1, 2, 3]);

    const row = await db
      .prepare("SELECT generated_count FROM ai_summaries WHERE couple_id = ?1 AND period_kind = 'month' AND period_key = ?2")
      .bind(couple.id, PAST_MONTH)
      .first<{ generated_count: number }>();
    expect(row?.generated_count).toBe(3);
  });

  // タスク定義4節「片方だけでは止まらない。期間ごとの枠が余っていても、
  // 暦月の合計で止まる」。ここでは「今の暦月」に対する歯止めを確かめる
  // 必要があるため、生成対象の期間は過去のものにしつつ、実際の生成（＝
  // ai_summaries.updated_atへの書き込み）は「今」起きることを利用する
  it("期間ごとの枠が余っていても、暦月の合計10回に達したら11回目はLIMIT_REACHED", async () => {
    const { owner } = await createCoupleOfTwo(true);
    // 異なる10個の週に投稿を作り、それぞれ1回ずつ生成する（どの週も
    // 期間ごとの上限3回には達しない。合計だけが10に達する）
    const weeks = Array.from({ length: 10 }, (_, i) => `2025-W${String(10 + i).padStart(2, "0")}`);
    for (const week of weeks) {
      await createPosts(owner, 3, "week", week);
    }

    for (const week of weeks) {
      const result = await call(
        router.aiSummary.generate,
        { periodKind: "week", periodKey: week },
        { context: contextFor(owner) },
      );
      expect(result.generatedCount).toBe(1); // どの期間も1回目（期間ごとの枠は余っている）
    }

    // 11回目（新しい期間・期間ごとの枠は満タンとは程遠い）が暦月合計で止まる
    const eleventhWeek = "2025-W20";
    await createPosts(owner, 3, "week", eleventhWeek);
    await expect(
      call(
        router.aiSummary.generate,
        { periodKind: "week", periodKey: eleventhWeek },
        { context: contextFor(owner) },
      ),
    ).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });

  // 確認観点「生成に失敗したとき、回数が減っていないか」＝増えてもいない
  // ことを確認する。予約（generated_count+1）の後にAPI呼び出し自体が
  // 失敗した場合、予約を巻き戻す実装になっているかを確かめる
  it("API呼び出しが失敗すると、予約した回数を巻き戻す（行ごと消える）", async () => {
    const { owner, couple } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);

    fetchMock.mockImplementationOnce(async () => new Response("internal error", { status: 500 }));

    await expect(
      call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) }),
    ).rejects.toThrow();

    // 1回目が失敗して予約が巻き戻っているため、行自体が残っていない
    const rowAfterFailure = await db
      .prepare("SELECT generated_count FROM ai_summaries WHERE couple_id = ?1 AND period_kind = 'month' AND period_key = ?2")
      .bind(couple.id, PAST_MONTH)
      .first<{ generated_count: number }>();
    expect(rowAfterFailure).toBeNull();

    // 巻き戻っているので、次の成功は1回目として記録される（2回目にならない）
    const result = await call(
      router.aiSummary.generate,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );
    expect(result.generatedCount).toBe(1);
  });

  it("入力に投稿本文以外（利用者名・ID・画像）が入らない。入っているのは本文とA/Bの記号だけ", async () => {
    const { owner, partner } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);

    await call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) });

    // fetchに渡された実際のリクエストボディ（プロバイダへ実際に送る内容）を見る。
    // generateSummary単体ではなく、実際に外へ出て行く直前の値を検査する
    const [, init] = fetchMock.mock.calls.at(-1) ?? [];
    const sentBody = String((init as RequestInit | undefined)?.body ?? "");
    expect(sentBody).toContain("テスト投稿0");
    expect(sentBody).toContain("テスト投稿1");
    expect(sentBody).toContain("テスト投稿2");
    // slotから機械的に決まる匿名の記号（A）は入るが、実名・ID・メールは入らない
    expect(sentBody).toContain("A: テスト投稿0");
    expect(sentBody).not.toContain(owner.name);
    expect(sentBody).not.toContain(owner.id);
    expect(sentBody).not.toContain(owner.email);
    expect(sentBody).not.toContain(partner.name);
    expect(sentBody).not.toContain(partner.id);
  });
});

describe("aiSummary.get", () => {
  it("生成前はnull、生成後はその内容を返す", async () => {
    const { owner } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);

    const before = await call(
      router.aiSummary.get,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );
    expect(before).toBeNull();

    await call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) });
    const after = await call(
      router.aiSummary.get,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );
    expect(after?.provider).toBe("openai");
    expect(after?.generatedCount).toBe(1);
  });

  it("未来の月はINVALID_INPUT", async () => {
    const { owner } = await createCoupleOfTwo(true);
    const [y] = currentMonthJst().split("-");
    const futureMonth = `${Number(y) + 1}-01`;

    await expect(
      call(router.aiSummary.get, { periodKind: "month", periodKey: futureMonth }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("今週もINVALID_INPUT", async () => {
    const { owner } = await createCoupleOfTwo(true);

    await expect(
      call(
        router.aiSummary.get,
        { periodKind: "week", periodKey: currentWeekJst() },
        { context: contextFor(owner) },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

// security-auditor指摘（Low）: periodKeyは形式（正規表現）だけでなく
// 値の妥当性も見る必要がある（2026-00・2026-13、53週を持たない年の
// W53等）。2025年はisoWeeksInYear(2025)===52であることを
// packages/date/test/date.test.tsのテストとは独立に、
// 手元で別実装した計算で確かめたうえで固定値として使う
describe("periodKeyの妥当性（形式だけでなく実在する期間か）", () => {
  it.each([
    ["month", "2025-00"],
    ["month", "2025-13"],
    ["week", "2025-W00"],
    ["week", "2025-W53"], // 2025年はISO週が52週までしかない
  ] as const)("periodKind=%s, periodKey=%sはBAD_REQUEST", async (periodKind, periodKey) => {
    const { owner } = await createCoupleOfTwo(true);

    await expect(
      call(router.aiSummary.get, { periodKind, periodKey }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("2025-W52（52週を持つ年の最終週）は通る", async () => {
    const { owner } = await createCoupleOfTwo(true);

    await expect(
      call(router.aiSummary.get, { periodKind: "week", periodKey: "2025-W52" }, { context: contextFor(owner) }),
    ).resolves.toBeNull();
  });
});

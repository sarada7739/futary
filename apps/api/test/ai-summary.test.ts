import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { currentMonthJst, currentWeekJst, jstMonthRangeMs, jstWeekRangeMs } from "@futary/date";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

// テストで本物の API を叩かない（037）。このテストは workerd 上で動く（@cloudflare/vitest-plugin）
// ので、vi.mock による ESM モジュールの差し替えは効かない。generateSummary はグローバルの fetch
// を直接呼ぶので、vi.stubGlobal で fetch 自体を差し替える（テストコードと手続きが同じ
// アイソレートのグローバルを共有している）
let fetchMock: ReturnType<typeof vi.fn>;

// プロバイダが返す本文。{{A}} {{B}} の置き換えを確かめるテストは、これを差し替えてから
// generate を呼ぶ（beforeEach で既定に戻る。044）
let mockedSummaryBody = "テストのAIまとめ本文";

beforeEach(() => {
  mockedSummaryBody = "テストのAIまとめ本文";
  fetchMock = vi.fn(async (url: string | URL) => {
    const href = url.toString();
    if (href.includes("openai.com")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: mockedSummaryBody } }] }), {
        status: 200,
      });
    }
    if (href.includes("anthropic.com")) {
      return new Response(JSON.stringify({ content: [{ text: mockedSummaryBody }] }), { status: 200 });
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
  // post.create は Date.now() を使うので、過去の期間の投稿は created_at を SQL で直接書く。
  // couple_id は post.create で作った行から引く
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

// currentMonthJst・currentWeekJst より確実に過去になる固定値。PAST_WEEK は PAST_MONTH と同じ月に
// しない（同じ月だと、週用に作った投稿が「月の投稿が 3 件未満」のテストの範囲に入り込む）
const PAST_MONTH = "2026-01";
const PAST_WEEK = "2025-W20";

// apply-migrations.ts の番人は素の代入で入れる（vi.stubGlobal だと vi.unstubAllGlobals が本物の
// fetch を復元先として覚え、差し替え忘れが本物の API へ静かに届く）。実際にモックを 1 つ剥がして、
// 本物の fetch へ行かず番人の例外で落ちることを確かめる
describe("番人（fetchの差し替え忘れ対策）が生きていること", () => {
  it("fetchの差し替えを外すと、本物のfetchではなく番人の例外に落ちる", () => {
    vi.unstubAllGlobals();
    // 番人は同期的に throw する（Promise を reject しない）ので、.rejects ではなく呼び出しを
    // 包んだ関数に .toThrow で確かめる
    expect(() => fetch("https://api.openai.com/v1/chat/completions")).toThrow(
      "fetchが差し替えられていません。テストが本物のAPIを叩こうとしています",
    );
  });
});

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
    expect(result.model).toBe("gpt-5.6-luna");
    expect(result.generatedCount).toBe(1);
    expect(result.body).toBe("テストのAIまとめ本文");
    // 差し替えが効いていること（宛先が openai.com）も見る
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

  // 1 人のペアでは使えない（相手がまだ居ないので同意が取れない。1節）
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

  // 認証済みの利用者が is_demo のペアに所属する（実際には起こりえない）組み合わせを直接作り、
  // 手続き自身の防御を確かめる（me.test.ts と同じ形）
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

  // 今月・今週はまだ終わっていないので拒む（9節）
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

    // 4 回目は API を呼ばないので generated_count は増えない。DB の値で直接確かめる
    // （確認観点「生成に失敗したとき、回数が減っていないか」の裏側）
    const row = await db
      .prepare("SELECT generated_count FROM ai_summaries WHERE couple_id = ?1 AND period_kind = 'month' AND period_key = ?2")
      .bind(couple.id, PAST_MONTH)
      .first<{ generated_count: number }>();
    expect(row?.generated_count).toBe(3);
  });

  // 期間ごとの歯止めが check-then-act だと、同じ期間へ並行に generate を投げたときにすり抜ける
  // （全部が同じ generated_count を読んで通り、API は N 回呼ばれるのに DB は 1 回分）。1 文の
  // 条件付き UPSERT（ON CONFLICT DO UPDATE ... WHERE generated_count < 3）なので、並行に投げても
  // 成功がちょうど 3 回・DB の値もちょうど 3 になる
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

    // 成功した 3 回の生成回数が重複なく 1・2・3（同じ番号を 2 つのリクエストが同時に取っていない）
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

  // 片方だけでは止まらない。期間ごとの枠が余っていても、暦月の合計で止まる（4節）。生成対象の
  // 期間は過去にしつつ、実際の生成（ai_summaries.updated_at への書き込み）は「今」起きることを使う
  it("期間ごとの枠が余っていても、暦月の合計10回に達したら11回目はLIMIT_REACHED", async () => {
    const { owner } = await createCoupleOfTwo(true);
    // 異なる 10 個の週で 1 回ずつ生成する（期間ごとの上限 3 回には達せず、合計だけが 10 に達する）
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

    // 11 回目（新しい期間。期間ごとの枠には余裕がある）が暦月の合計で止まる
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

  // 予約（generated_count+1）の後に API 呼び出しが失敗したら、予約を巻き戻す
  // （確認観点「生成に失敗したとき、回数が減っていないか」＝増えてもいない）
  it("API呼び出しが失敗すると、予約した回数を巻き戻す（行ごと消える）", async () => {
    const { owner, couple } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);

    fetchMock.mockImplementationOnce(async () => new Response("internal error", { status: 500 }));

    await expect(
      call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) }),
    ).rejects.toThrow();

    // 予約が巻き戻っているので行自体が残っていない
    const rowAfterFailure = await db
      .prepare("SELECT generated_count FROM ai_summaries WHERE couple_id = ?1 AND period_kind = 'month' AND period_key = ?2")
      .bind(couple.id, PAST_MONTH)
      .first<{ generated_count: number }>();
    expect(rowAfterFailure).toBeNull();

    // 次の成功は 1 回目として記録される
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

    // generateSummary 単体ではなく、fetch に渡された実際のリクエストボディ（外へ出る直前）を見る
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
    // 表示名の代わりに、出力を {{A}} {{B}} で書く指示が system に入っている（置き換えはサーバが
    // 応答時にやる。044 T1）
    expect(sentBody).toContain("必ず {{A}} {{B}} とだけ書いてください");
    expect(sentBody).not.toContain(partner.email);
  });

  // 相手の投稿は "B:" として送る（どの発言が誰のものか AI が区別できる。ADR-013）
  it("相手（slot=2）の投稿には B の記号が付く（A と両方混在させて確認）", async () => {
    const { owner, partner } = await createCoupleOfTwo(true);
    await createPosts(owner, 2, "month", PAST_MONTH);
    await createPosts(partner, 1, "month", PAST_MONTH);

    await call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) });

    const [, init] = fetchMock.mock.calls.at(-1) ?? [];
    const sentBody = String((init as RequestInit | undefined)?.body ?? "");
    expect(sentBody).toContain("A: テスト投稿0");
    expect(sentBody).toContain("A: テスト投稿1");
    expect(sentBody).toContain("B: テスト投稿0");
  });

  // ai-summary.ts の labelByUserId.get(...) ?? "A"（メンバーでない author_id を A に寄せる）を、
  // couple_members に居ない author_id の投稿を SQL で直接作って確かめる。通常の経路では起こらないが、
  // fallback の分岐が生きていることを見る（posts.author_id は user.id への FK なので user 行は要る）
  it("couple_membersに居ないauthor_idの投稿はAに寄せる（fallback）", async () => {
    const { owner, couple } = await createCoupleOfTwo(true);
    await createPosts(owner, 2, "month", PAST_MONTH);
    const stranger = await createUser();
    const { fromMs } = rangeFor("month", PAST_MONTH);
    await db
      .prepare("INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(crypto.randomUUID(), couple.id, stranger.id, "見知らぬ投稿者の投稿", Math.floor(fromMs / 1000) + 10000)
      .run();

    await call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) });

    const [, init] = fetchMock.mock.calls.at(-1) ?? [];
    const sentBody = String((init as RequestInit | undefined)?.body ?? "");
    expect(sentBody).toContain("A: 見知らぬ投稿者の投稿");
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

// まとめの中の {{A}} {{B}} を、応答を返すときにサーバが表示名へ置き換える（044）。保存
// （ai_summaries.body）は印のまま。表示名は user.name。owner が slot 1（A）、partner が slot 2（B）
describe("044: 応答の {{A}} {{B}} を表示名に置き換える（保存は印のまま）", () => {
  const SAMPLE_BODY =
    "{{A}}と{{B}}は公園へ出かけた。{{A}}はAランチを食べ、{{B}}はB級グルメを楽しんだ。{{AB}}と{A}とAさんはそのまま。";

  async function insertSummaryRow(coupleId: string, body: string) {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `INSERT INTO ai_summaries (couple_id, period_kind, period_key, body, provider, model, generated_count, created_at, updated_at)
         VALUES (?1, 'month', ?2, ?3, 'openai', 'gpt-5.6-luna', 1, ?4, ?4)`,
      )
      .bind(coupleId, PAST_MONTH, body, now)
      .run();
  }

  it("T2: generate が保存する body は {{A}} {{B}} のまま（DB を直接読む）", async () => {
    const { owner, couple } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);
    mockedSummaryBody = SAMPLE_BODY;

    await call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) });

    const row = await db
      .prepare("SELECT body FROM ai_summaries WHERE couple_id = ?1 AND period_kind = 'month' AND period_key = ?2")
      .bind(couple.id, PAST_MONTH)
      .first<{ body: string }>();
    expect(row?.body).toBe(SAMPLE_BODY);
    expect(row?.body).not.toContain(owner.name);
  });

  it("T3: generate の応答で {{A}} {{B}} が表示名になる。{{AB}}・{A}・素の A は変わらない。複数回出ても全部", async () => {
    const { owner, partner } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);
    mockedSummaryBody = SAMPLE_BODY;

    const result = await call(
      router.aiSummary.generate,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );

    expect(result.body).toBe(
      `${owner.name}と${partner.name}は公園へ出かけた。${owner.name}はAランチを食べ、${partner.name}はB級グルメを楽しんだ。{{AB}}と{A}とAさんはそのまま。`,
    );
    expect(result.body).not.toContain("{{A}}");
    expect(result.body).not.toContain("{{B}}");
  });

  it("T3: get の応答でも同じ置き換えが効く。相手が呼んでも A/B の対応は slot で決まり変わらない", async () => {
    const { owner, partner } = await createCoupleOfTwo(true);
    await createPosts(owner, 3, "month", PAST_MONTH);
    mockedSummaryBody = SAMPLE_BODY;
    await call(router.aiSummary.generate, { periodKind: "month", periodKey: PAST_MONTH }, { context: contextFor(owner) });

    const byOwner = await call(
      router.aiSummary.get,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );
    const byPartner = await call(
      router.aiSummary.get,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(partner) },
    );
    expect(byOwner?.body).toContain(`${owner.name}と${partner.name}は公園へ出かけた`);
    expect(byOwner?.body).toContain("{{AB}}と{A}とAさんはそのまま");
    expect(byPartner?.body).toBe(byOwner?.body);
  });

  it("T3: 表示名を変えると、作り直さなくても次の get から新しい名前で出る（保存が印のままの効き目）", async () => {
    const { owner, couple } = await createCoupleOfTwo(true);
    await insertSummaryRow(couple.id, "{{A}}の一日。");

    await call(router.me.update, { name: "あたらしい名前" }, { context: contextFor(owner) });

    const after = await call(
      router.aiSummary.get,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );
    expect(after?.body).toBe("あたらしい名前の一日。");
  });

  it("古い形（素の A/B）のまとめはそのまま出る（置き換えない）", async () => {
    const { owner, couple } = await createCoupleOfTwo(true);
    await insertSummaryRow(couple.id, "Aは散歩へ行き、Bは料理をした。");

    const result = await call(
      router.aiSummary.get,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );
    expect(result?.body).toBe("Aは散歩へ行き、Bは料理をした。");
  });

  it("T4: 1 人のペアでは {{B}} が「相手」になる（get。generate は 1 人では FORBIDDEN）", async () => {
    const owner = await createUser();
    const couple = await call(router.couple.create, {}, { context: contextFor(owner) });
    await insertSummaryRow(couple.id, "{{A}}と{{B}}の一日。");

    const result = await call(
      router.aiSummary.get,
      { periodKind: "month", periodKey: PAST_MONTH },
      { context: contextFor(owner) },
    );
    expect(result?.body).toBe(`${owner.name}と相手の一日。`);
  });
});

// periodKey は形式だけでなく値の妥当性も見る（2026-00・2026-13、53 週を持たない年の W53 等）。
// isoWeeksInYear(2025) === 52 は別の計算で確かめたうえで固定値として使う
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

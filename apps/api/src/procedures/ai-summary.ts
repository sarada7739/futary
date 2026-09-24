import { currentMonthJst, currentWeekJst, jstMonthRangeMs, jstWeekRangeMs } from "@futary/date";
import { generateSummary, substituteNames, type PostEntry, type SummaryNames } from "../lib/ai";
import { implementer } from "../implementer";
import { readProcedure, writeProcedure } from "./base";

// 期間ごと 3 回まで・1 ペア 1 暦月の合計 10 回まで（月次 3 + 週次 5 週 × 3 = 18 回/月のピークを抑える二段。037）
const MAX_GENERATIONS_PER_PERIOD = 3;
const MAX_GENERATIONS_PER_CALENDAR_MONTH = 10;
// 投稿が 3 件未満の期間は生成しない（月・週で同じ）
const MIN_POSTS_TO_SUMMARIZE = 3;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

type PeriodKind = "month" | "week";

// 週の計算は packages/date に置き、ここでは計算しない（architecture.md 5節）
function periodRangeMs(periodKind: PeriodKind, periodKey: string): { fromMs: number; toMs: number } {
  return periodKind === "month" ? jstMonthRangeMs(periodKey) : jstWeekRangeMs(periodKey);
}

// 進行中の期間（今月・今週）も未来も拒む。YYYY-MM・YYYY-Www はゼロ埋めなので辞書順 = 数値順
function isCurrentOrFuturePeriod(periodKind: PeriodKind, periodKey: string): boolean {
  return periodKind === "month" ? periodKey >= currentMonthJst() : periodKey >= currentWeekJst();
}

interface AiSummaryRow {
  body: string;
  provider: string;
  model: string;
  generated_count: number;
  updated_at: number;
}

interface MemberRow {
  user_id: string;
  slot: number;
  ai_opt_in: number;
  name: string | null;
}

// メンバーを slot 付きで読む。表示名は user.name（他の画面と同じ出所。2 箇所に持たない）。
// generate は同意の判定と A/B の記号にも使う
async function loadMembers(db: D1Database, coupleId: string): Promise<MemberRow[]> {
  const result = await db
    .prepare(
      `SELECT couple_members.user_id AS user_id, couple_members.slot AS slot,
              couple_members.ai_opt_in AS ai_opt_in, user.name AS name
         FROM couple_members
         LEFT JOIN user ON user.id = couple_members.user_id
        WHERE couple_members.couple_id = ?1`,
    )
    .bind(coupleId)
    .all<MemberRow>();
  return result.results;
}

// {{A}} {{B}} に入れる表示名。slot 1 が A、slot 2 が B。相手が居なければ「相手」（空文字だと文が壊れる。044）
const PARTNER_FALLBACK_NAME = "相手";

function namesBySlot(members: MemberRow[]): SummaryNames {
  const nameOf = (slot: number) => members.find((m) => m.slot === slot)?.name ?? PARTNER_FALLBACK_NAME;
  return { A: nameOf(1), B: nameOf(2) };
}

function toAiSummary(row: AiSummaryRow, names: SummaryNames) {
  return {
    // 保存は {{A}} {{B}} のまま。返すときだけ置き換える
    body: substituteNames(row.body, names),
    // generateSummary の provider しか書かない（CHECK 制約もある）
    provider: row.provider as "openai" | "anthropic",
    model: row.model,
    updatedAt: row.updated_at,
    generatedCount: row.generated_count,
  };
}

// aiSummary.get: 生成済みの内容を読むだけ（生成はしない）
const aiSummaryGet = implementer.aiSummary.get.use(readProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId } = context;

  if (isCurrentOrFuturePeriod(input.periodKind, input.periodKey)) throw errors.INVALID_INPUT();

  const row = await db
    .prepare(
      `SELECT body, provider, model, generated_count, updated_at
         FROM ai_summaries
        WHERE couple_id = ?1 AND period_kind = ?2 AND period_key = ?3`,
    )
    .bind(coupleId, input.periodKind, input.periodKey)
    .first<AiSummaryRow>();

  if (!row) return null;
  return toAiSummary(row, namesBySlot(await loadMembers(db, coupleId)));
});

// デモペアは他の経路（ログイン経路が無い・シードが同意を立てない）で到達しないが、デモの本文が
// 外部へ出る唯一の経路なので、それを他の仕組みだけに頼らない
async function isDemoCouple(db: D1Database, coupleId: string): Promise<boolean> {
  const row = await db.prepare("SELECT is_demo FROM couples WHERE id = ?1").bind(coupleId).first<{
    is_demo: number;
  }>();
  return Boolean(row?.is_demo);
}

// aiSummary.generate: 新規生成、または同じ期間への作り直し（上書き）
const aiSummaryGenerate = implementer.aiSummary.generate
  .use(writeProcedure)
  .handler(async ({ context, input, errors }) => {
    const { db, coupleId } = context;

    if (isCurrentOrFuturePeriod(input.periodKind, input.periodKey)) throw errors.INVALID_INPUT();

    if (await isDemoCouple(db, coupleId)) throw errors.FORBIDDEN();

    // 投稿はふたりのもの。2 人とも同意していないと使えない（1 人のペアもここで FORBIDDEN。ADR-013）
    const members = await loadMembers(db, coupleId);
    if (members.length < 2 || members.some((m) => !m.ai_opt_in)) {
      throw errors.FORBIDDEN();
    }

    // 投稿者は slot から決まる「A」「B」で区別し、実名・user_id は外へ出さない（ADR-013）。
    // 表示名は応答の置き換えにだけ使い、LLM には渡さない
    const labelByUserId = new Map<string, "A" | "B">(members.map((m) => [m.user_id, m.slot === 1 ? "A" : "B"]));
    const names = namesBySlot(members);

    // 期間ごとの歯止めは、API を呼ぶ前に 1 文の条件付き UPSERT で「予約」する。読んでから書く形だと、
    // 並行に投げた全部が同じ回数を読んで通り、呼び出しの数だけ費用が出る。
    // D1 は文を直列に実行するので、この 1 文はレースしない。ON CONFLICT DO UPDATE ... WHERE が
    // 偽なら何も書かず RETURNING も空になる = 上限に達した
    const reserveNow = nowSeconds();
    const reserved = await db
      .prepare(
        `INSERT INTO ai_summaries (couple_id, period_kind, period_key, body, provider, model, generated_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, '', 'openai', '', 1, ?4, ?4)
         ON CONFLICT (couple_id, period_kind, period_key) DO UPDATE SET
           generated_count = ai_summaries.generated_count + 1,
           updated_at = excluded.updated_at
         WHERE ai_summaries.generated_count < ?5
         RETURNING generated_count`,
      )
      .bind(coupleId, input.periodKind, input.periodKey, reserveNow, MAX_GENERATIONS_PER_PERIOD)
      .first<{ generated_count: number }>();
    if (!reserved) throw errors.LIMIT_REACHED();
    const generatedCount = reserved.generated_count;

    // この先で失敗したら予約した 1 回を取り消す（回数だけ進んで生成されない状態を残さない）
    async function rollbackReservation(): Promise<void> {
      await db
        .prepare(
          `UPDATE ai_summaries SET generated_count = generated_count - 1
             WHERE couple_id = ?1 AND period_kind = ?2 AND period_key = ?3`,
        )
        .bind(coupleId, input.periodKind, input.periodKey)
        .run();
      // この呼び出しが行を作っていたなら、0 に戻った空の行を消す。
      // 並行した他の呼び出しが成功していれば 0 にならないので消えない
      await db
        .prepare(
          `DELETE FROM ai_summaries
             WHERE couple_id = ?1 AND period_kind = ?2 AND period_key = ?3 AND generated_count <= 0`,
        )
        .bind(coupleId, input.periodKind, input.periodKey)
        .run();
    }

    try {
      // 暦月の合計を数える表は無いので、「updated_at が今月の行の generated_count の合計」で近似する。
      // 1 文で原子化していないが、並行した予約（上の UPSERT）はこの読み取りより前に確定するので、
      // 異なる期間へ同時に投げても 10 を超えて通らなかった（実測。D1 の実装の挙動で、契約ではない）。
      // 近似は多く数える方向にしかずれない。厳密にするなら暦月のカウンタ行を同じ UPSERT にする
      const monthNow = currentMonthJst();
      const { fromMs: monthFromMs, toMs: monthToMs } = jstMonthRangeMs(monthNow);
      const monthlyTotalRow = await db
        .prepare(
          `SELECT COALESCE(SUM(generated_count), 0) AS total
             FROM ai_summaries
            WHERE couple_id = ?1 AND updated_at >= ?2 AND updated_at < ?3`,
        )
        .bind(coupleId, Math.floor(monthFromMs / 1000), Math.floor(monthToMs / 1000))
        .first<{ total: number }>();
      if ((monthlyTotalRow?.total ?? 0) > MAX_GENERATIONS_PER_CALENDAR_MONTH) {
        throw errors.LIMIT_REACHED();
      }

      // 入力に入れるのは本文と A/B の記号だけ（画像・名前・ID は入れない）。author_id は記号に変えるためだけに使う
      const { fromMs, toMs } = periodRangeMs(input.periodKind, input.periodKey);
      const posts = await db
        .prepare(
          `SELECT author_id AS author_id, body FROM posts
            WHERE couple_id = ?1 AND deleted_at IS NULL
              AND created_at >= ?2 AND created_at < ?3
            ORDER BY created_at ASC`,
        )
        .bind(coupleId, Math.floor(fromMs / 1000), Math.floor(toMs / 1000))
        .all<{ author_id: string; body: string }>();

      if (posts.results.length < MIN_POSTS_TO_SUMMARIZE) throw errors.INVALID_INPUT();

      const entries: PostEntry[] = posts.results.map((p) => ({
        label: labelByUserId.get(p.author_id) ?? "A",
        body: p.body,
      }));

      // 費用が出るのはここ。歯止めは全部これより前に置く
      const result = await generateSummary(context.aiEnv, entries);

      const now = nowSeconds();
      await db
        .prepare(
          `UPDATE ai_summaries SET body = ?1, provider = ?2, model = ?3, updated_at = ?4
             WHERE couple_id = ?5 AND period_kind = ?6 AND period_key = ?7`,
        )
        .bind(result.body, result.provider, result.model, now, coupleId, input.periodKind, input.periodKey)
        .run();

      return {
        // DB には印のまま書いた。返すときだけ表示名にする
        body: substituteNames(result.body, names),
        provider: result.provider,
        model: result.model,
        updatedAt: now,
        generatedCount,
      };
    } catch (error) {
      await rollbackReservation();
      throw error;
    }
  });

export const aiSummaryProcedures = {
  get: aiSummaryGet,
  generate: aiSummaryGenerate,
};

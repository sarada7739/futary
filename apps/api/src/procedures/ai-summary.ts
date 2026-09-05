import { currentMonthJst, currentWeekJst, jstMonthRangeMs, jstWeekRangeMs } from "@futary/date";
import { generateSummary, type PostEntry } from "../lib/ai";
import { implementer } from "../implementer";
import { readProcedure, writeProcedure } from "./base";

// タスク定義4節: 期間ごと3回まで。1ペア・1暦月あたりの合計は10回まで
// （月次3 + 週次5週分×3 = 18回/月というピークを抑える二段の歯止め）
const MAX_GENERATIONS_PER_PERIOD = 3;
const MAX_GENERATIONS_PER_CALENDAR_MONTH = 10;
// タスク定義5節: 投稿が3件未満の期間は生成しない（月・週で基準を変えない）
const MIN_POSTS_TO_SUMMARIZE = 3;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

type PeriodKind = "month" | "week";

// periodKind/periodKeyから、その期間が覆うUnixミリ秒の範囲を返す。
// 週の計算はpackages/dateに置き、ここでは計算しない（architecture.md 5節）
function periodRangeMs(periodKind: PeriodKind, periodKey: string): { fromMs: number; toMs: number } {
  return periodKind === "month" ? jstMonthRangeMs(periodKey) : jstWeekRangeMs(periodKey);
}

// 今月・今週も「まだ終わっていない」ので拒む（未来はもちろん、進行中の
// 期間も拒む。タスク定義7節・9節）。YYYY-MM/YYYY-Wwwはどちらもゼロ埋め
// されており、辞書順の比較が数値順と一致する
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

function toAiSummary(row: AiSummaryRow) {
  return {
    body: row.body,
    // contractのz.enum(AI_PROVIDERS)と一致する値しかDBに書かない
    // （generateSummaryの戻り値のprovider由来。CHECK制約でも保証済み）
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

  return row ? toAiSummary(row) : null;
});

// security-auditor指摘: デモペアは他の経路（email_verified=0・
// @example.com・シードがai_opt_inを立てない）で現状は到達不能だが、
// me.ts（me.delete）が同じ理由で自前のis_demoガードを持っているのと
// 非対称にしない。デモの投稿本文が外部プロバイダへ出る唯一の経路である
// 以上、到達不能性を他の仕組み1つに依存させない
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

    // ADR-013: 投稿はふたりのもの。2人とも同意していないと使えない
    // （1人のペアはpartnerが存在しないため、この判定で自動的にFORBIDDENになる）
    const members = await db
      .prepare(
        "SELECT user_id AS user_id, slot AS slot, ai_opt_in AS ai_opt_in FROM couple_members WHERE couple_id = ?1",
      )
      .bind(coupleId)
      .all<{ user_id: string; slot: number; ai_opt_in: number }>();
    if (members.results.length < 2 || members.results.some((m) => !m.ai_opt_in)) {
      throw errors.FORBIDDEN();
    }

    // 投稿者を実名ではなく「A」「B」という匿名の記号で区別する（人間の指摘。
    // ADR-013に追記済み）。slotから機械的に決まり、実名・user_idは外部へ
    // 一切出ない（lib/ai.tsのSYSTEM_PROMPTでAIにも実名でないことを明示）
    const labelByUserId = new Map<string, "A" | "B">(
      members.results.map((m) => [m.user_id, m.slot === 1 ? "A" : "B"]),
    );

    // 【security-auditor指摘・訂正】以前はSELECTで既存の回数を読んでから
    // 生成後にINSERTしていた（check-then-act）。同じ期間へ複数の
    // generateを並行に投げると、全てが同じgenerated_countを読んで通過し、
    // N回の外部API呼び出しが発生するのにDB上は1回分しか記録されない
    // レースが実測せずとも構造上あった。
    //
    // 期間ごとの歯止め（3回まで）は、実際にAPIを呼ぶ前に「予約」する形の
    // 1文の条件付きUPSERTに直した。D1（SQLite）は単一ライタで各文が
    // 直列に実行されるため、この1文自体はレースしない。
    // ON CONFLICT DO UPDATE ... WHERE が偽の行はDO NOTHING相当になり
    // （SQLiteの仕様）、RETURNINGも空になる。それを「予約できなかった
    // ＝期間ごとの上限に達した」の合図として使う
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

    // ここから先で失敗したら、上で予約した1回ぶんを取り消す
    // （回数だけ進んで実際には生成されない、という状態を残さない）
    async function rollbackReservation(): Promise<void> {
      await db
        .prepare(
          `UPDATE ai_summaries SET generated_count = generated_count - 1
             WHERE couple_id = ?1 AND period_kind = ?2 AND period_key = ?3`,
        )
        .bind(coupleId, input.periodKind, input.periodKey)
        .run();
      // 予約が今回で1件目（＝この呼び出しがこの行を新規作成した）だった
      // 場合、0まで戻したら空の行（bodyが空文字のまま）を残さず消す。
      // 他の並行呼び出しが先に成功していればgenerated_countは0にならない
      // ため、その行は消えない
      await db
        .prepare(
          `DELETE FROM ai_summaries
             WHERE couple_id = ?1 AND period_kind = ?2 AND period_key = ?3 AND generated_count <= 0`,
        )
        .bind(coupleId, input.periodKind, input.periodKey)
        .run();
    }

    try {
      // 【設計判断・security-auditor指摘で保留】ai_summariesは期間ごとに
      // 1行しか持たず、生成のたびの個別ログは無い。「今の暦月に何回
      // 使ったか」を正確に数える表が無いため、「updated_atが今の暦月に
      // 入っている行のgenerated_countの合計」で近似する。この事前チェックは
      // 上の期間ごとの歯止めと違い1文で原子化していないため、複数の期間へ
      // 同時に投げると暦月合計が10をわずかに超えて通る窓が残る
      // （読み取りと予約の間に別の予約が挟まる）。金銭的な影響は小さく、
      // 悪用も認証済み・同意済みのペア本人に限られるため、いまは
      // 許容する（security-auditor指摘。厳密にするなら暦月ごとの
      // カウンタ行を持って同じ条件付きUPSERTにする）
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

      // その期間の投稿本文と投稿者を古い順で取得する。画像・利用者名・IDは
      // 入れない（タスク定義8節「入力に入れるのは本文とA/Bの記号だけ」）。
      // author_idはここでA/Bの記号に変換するためだけに使い、そのままでは
      // 外へ出さない
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

      // ここで初めて実際にAPIを呼ぶ（費用が発生する箇所。上の歯止めは
      // すべてこれより前に置く）
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
        body: result.body,
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

import { isoWeeksInYear } from "@futary/date";
import { oc } from "@orpc/contract";
import { z } from "zod";

export const PERIOD_KINDS = ["month", "week"] as const;
const periodKindSchema = z.enum(PERIOD_KINDS);

// YYYY-MM（JST）。event.ts/mood.tsのdateSchema（YYYY-MM-DD）と同じ考え方
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
// YYYY-Www（ISO 8601週。JST。月曜始まり。packages/dateのisoWeekKeyが作る形）
const WEEK_KEY_PATTERN = /^(\d{4})-W(\d{2})$/;

// 【security-auditor指摘・訂正】形式（正規表現）だけでは2026-00・2026-13や
// 2025-W00・2025-W53（53週を持たない年）のような実在しない期間を通して
// しまい、packages/dateのjstMonthRangeMs/jstWeekRangeMsが例外を出さず
// 隣接する別の期間へずれた範囲を返す（実在しないキーの行がai_summariesに
// 作られる）。形式だけでなく値の妥当性もrefineで見る
function isValidPeriodKey(periodKind: "month" | "week", periodKey: string): boolean {
  if (periodKind === "month") {
    const match = MONTH_KEY_PATTERN.exec(periodKey);
    if (!match) return false;
    const month = Number(match[2]);
    return month >= 1 && month <= 12;
  }
  const match = WEEK_KEY_PATTERN.exec(periodKey);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  return week >= 1 && week <= isoWeeksInYear(year);
}

// periodKindとperiodKeyの組み合わせ・値の妥当性をZodのrefineで見る
// （BAD_REQUESTでよい。conventions.md 5節「入力だけで判定できる条件は
// Zodに置く」）
const periodInputSchema = z
  .object({ periodKind: periodKindSchema, periodKey: z.string() })
  .refine((v) => isValidPeriodKey(v.periodKind, v.periodKey), {
    message: "periodKeyがperiodKindに対して不正です",
  });

export const AI_PROVIDERS = ["openai", "anthropic"] as const;
const providerSchema = z.enum(AI_PROVIDERS);

// タスク定義8節「出力を信用しない」: bodyは素のテキストとして表示するだけの
// 前提（画面側でリンク化・マークダウン解釈をしない）
export const aiSummarySchema = z.object({
  body: z.string(),
  provider: providerSchema,
  model: z.string(),
  updatedAt: z.number(),
  generatedCount: z.number().int(),
});

export type AiSummary = z.infer<typeof aiSummarySchema>;

// aiSummary.get: 生成済みならその内容、無ければnull。生成はしない（読むだけ）。
// 未来の期間は拒む。今月・今週も「まだ終わっていない」ので拒む（タスク定義7節）
export const aiSummaryGetContract = oc
  .input(periodInputSchema)
  .output(aiSummarySchema.nullable())
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    // 未来の期間・今月/今週
    INVALID_INPUT: { status: 400 },
  });

// aiSummary.generate: 新規生成、または同じ期間への作り直し（上書き。
// generatedCountをインクリメントする。タスク定義6節）
// FORBIDDEN: 2人とも同意していない（1人のペアも含む。ADR-013）
// INVALID_INPUT: 未来/今の期間、またはその期間の投稿が3件未満（タスク定義5節）
// LIMIT_REACHED: その期間の4回目（期間ごと3回まで）、または
//                その暦月の11回目（1ペア・1暦月あたり10回まで。タスク定義4節）
export const aiSummaryGenerateContract = oc
  .input(periodInputSchema)
  .output(aiSummarySchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    INVALID_INPUT: { status: 400 },
    LIMIT_REACHED: { status: 409 },
  });

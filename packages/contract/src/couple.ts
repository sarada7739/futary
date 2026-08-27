import { oc } from "@orpc/contract";
import { z } from "zod";

// タイムゾーンは Asia/Tokyo 固定（architecture.md 4節）。UTCに9時間足してから
// 日付部分だけを取り出すことでJSTの「今日」を得る
function todayInJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const MIN_ANNIVERSARY_DATE = "1900-01-01";

// YYYY-MM-DD 形式・実在する日付・妥当な範囲（1900-01-01〜今日）であることを検証する
const anniversaryDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), {
    message: "存在しない日付です",
  })
  .refine((value) => value >= MIN_ANNIVERSARY_DATE, {
    message: `${MIN_ANNIVERSARY_DATE} 以降の日付を指定してください`,
  })
  .refine((value) => value <= todayInJst(), {
    message: "未来の日付は指定できません",
  });

export const coupleSchema = z.object({
  id: z.string(),
  anniversaryDate: z.string(),
  createdAt: z.number(),
});

// couple.create: 認証済みユーザーがペアを作り、自分をスロット1で参加させる
export const coupleCreateContract = oc
  .input(z.object({ anniversaryDate: anniversaryDateSchema }))
  .output(coupleSchema)
  .errors({
    // 未認証、または既に別のペアに所属している
    FORBIDDEN: {},
  });

// couple.get: 自分が所属するペアを返す
export const coupleGetContract = oc.output(coupleSchema).errors({
  FORBIDDEN: {},
  // 認証済みだがどのペアにも所属していない
  NEEDS_ONBOARDING: { status: 409 },
});

// couple.update: 自分が所属するペアの付き合った日を変更する
export const coupleUpdateContract = oc
  .input(z.object({ anniversaryDate: anniversaryDateSchema }))
  .output(coupleSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
  });

import { oc } from "@orpc/contract";
import { isValidDate, todayJst, yearsBefore } from "@futary/date";
import { z } from "zod";

const MIN_ANNIVERSARY_DATE = "1900-01-01";

// YYYY-MM-DD 形式・実在する日付・妥当な範囲であることを検証する。
// 日付計算は @futary/date に集約する（architecture.md 5節・L63）。
// 以前はここに JST の「今日」を独自に計算するコードがあり、todayJst の
// 3つ目の重複実装になっていた（011の重複はB自身が気づいたが、こちらはESLint
// ルール導入で機械的に発見した）
//
// 上限は「今日まで」ではなく「1年後まで」（L66・Aの決定）。人間が
// 「記念日が未来の日付なら『あと○日』を出す」を採用したため、未来の記念日を
// 登録できる必要がある。1年後という上限は業務上の意味ではなく、
// 1900-01-01の下限と同じ「打ち間違いを弾くための歯止め」（例: 2126-05-18）
const anniversaryDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください")
  .refine((value) => isValidDate(value), {
    message: "存在しない日付です",
  })
  .refine((value) => value >= MIN_ANNIVERSARY_DATE, {
    message: `${MIN_ANNIVERSARY_DATE} 以降の日付を指定してください`,
  })
  .refine((value) => value <= yearsBefore(todayJst(), -1), {
    message: "1年より先の日付は指定できません",
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

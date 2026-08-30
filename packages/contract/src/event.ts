import { oc } from "@orpc/contract";
import { z } from "zod";

// ADR-009: 記念日・予定・会った日を1テーブルに統合する
export const EVENT_KINDS = ["anniversary", "plan", "meetup"] as const;
const eventKindSchema = z.enum(EVENT_KINDS);

// 日付は YYYY-MM-DD の文字列（architecture.md 4節）。実在する日付かどうかは
// ここでは検証しない（存在しない日付を弾く refine を足すと、02-29 の記念日を
// 「今日は平年だから」という理由で拒否してしまう。カレンダー上の妥当性は
// 「実在した年に一度は登録された日付である」ことでしか判断できず、
// 手続き単体では判定できない）
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(DATE_PATTERN, "日付はYYYY-MM-DD形式で指定してください");

const MAX_TITLE_LENGTH = 200;

export const eventSchema = z.object({
  id: z.string(),
  // 射影後の日付（表示する日）。architecture.md 5節「繰り返し記念日の射影」
  date: dateSchema,
  // 登録された日付。repeatYearly でなければ date と同じ
  sourceDate: dateSchema,
  title: z.string(),
  kind: eventKindSchema,
  repeatYearly: z.boolean(),
});

export type Event = z.infer<typeof eventSchema>;

// event.list: 範囲は最大400日。超えたら INVALID_INPUT（architecture.md 5節）。
// repeat_yearly の記念日は範囲が触れる年それぞれに射影して返すため、
// 同じ id が複数回・同じ date が複数回現れることがある（重複除去はしない）
export const eventListContract = oc
  .input(z.object({ from: dateSchema, to: dateSchema }))
  .output(z.object({ items: z.array(eventSchema) }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    // from > to、または範囲が400日を超える
    INVALID_INPUT: { status: 400 },
  });

const eventInputBaseSchema = z.object({
  date: dateSchema,
  title: z.string().trim().min(1, "タイトルを入力してください").max(MAX_TITLE_LENGTH),
  kind: eventKindSchema,
  repeatYearly: z.boolean(),
});

// repeatYearly は kind='anniversary' のときだけ true にできる（L67・Aの決定）。
// DBのCHECK制約は置かない。書き込み口がこの入力スキーマの1つしか無く、
// ここで弾けば到達しないため（posts.image_keyのUNIQUE制約とは事情が違う。
// あちらは複数行を数えて判断する形を避けるための宣言的制約）
function refineRepeatYearlyKind<T extends z.ZodType<{ kind: string; repeatYearly: boolean }>>(schema: T) {
  return schema.refine((value) => value.kind === "anniversary" || !value.repeatYearly, {
    message: "repeatYearlyはkindが記念日のときだけtrueにできます",
    path: ["repeatYearly"],
  });
}

const eventInputSchema = refineRepeatYearlyKind(eventInputBaseSchema);

export const eventCreateContract = oc.input(eventInputSchema).output(eventSchema).errors({
  FORBIDDEN: {},
  NEEDS_ONBOARDING: { status: 409 },
  INVALID_INPUT: { status: 400 },
});

// event.update: WHERE 句に couple_id を含めた1文で行う（006の post.delete と同じ形）。
// 部分更新にはせず、create と同じ全項目を受け取って置き換える
export const eventUpdateContract = oc
  .input(refineRepeatYearlyKind(eventInputBaseSchema.extend({ id: z.string() })))
  .output(eventSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
    INVALID_INPUT: { status: 400 },
  });

export const eventDeleteContract = oc
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

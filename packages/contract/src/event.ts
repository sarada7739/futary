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

// HH:MM の24時間表記。JSTの壁時計としての時刻であってある瞬間ではない
// （date を YYYY-MM-DD の文字列で持つのと同じ理由。architecture.md 4節・5節）
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeSchema = z.string().regex(TIME_PATTERN, "時間はHH:MM形式で指定してください");

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
  // HH:MM または null。anniversary には設定できない（018）
  time: timeSchema.nullable(),
  // 設定した人の名前。null許容（LEFT JOIN。post.authorName と同じ形。018）
  createdByName: z.string().nullable(),
  // 「ふたりの予定」（021）。kind='plan'のときだけtrueになりうる
  isShared: z.boolean(),
  // このイベントを閲覧者が編集・削除できるか。サーバが計算して返す
  // （021。createdByIdは返さない。権限規則〈kind・isShared・設定者かどうか〉を
  // クライアント側に再度書かせないため。architecture.md 5節）
  canEdit: z.boolean(),
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
  // HH:MM。任意。anniversary には設定できない（下のrefine。018・architecture.md 5節）
  time: timeSchema.nullable().optional(),
  // 「ふたりの予定」（021）。kind='plan'のときだけtrueにできる（下のrefine）
  isShared: z.boolean(),
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

// timeはkind='anniversary'のときだけ設定できない（repeatYearlyと同じ形。018）。
// 記念日は「日」であって時刻を持つ概念ではなく、毎年射影される性質とも噛み合わない
function refineTimeKind<T extends z.ZodType<{ kind: string; time?: string | null }>>(schema: T) {
  return schema.refine((value) => !(value.kind === "anniversary" && value.time != null), {
    message: "timeはkindが記念日のときは設定できません",
    path: ["time"],
  });
}

// isSharedはkind='plan'のときだけtrueにできる（021。repeatYearlyと同じ形）。
// DBのCHECK制約（events_is_shared_check）も置く。書き込み口は入力スキーマの
// 1つしか無いため到達しないはずだが、014のシードなど入力スキーマを通らない
// 書き込み口ができたときの備えとしてCHECKも残す（events_kind_checkと同じ理由）
function refineIsSharedKind<T extends z.ZodType<{ kind: string; isShared: boolean }>>(schema: T) {
  return schema.refine((value) => value.kind === "plan" || !value.isShared, {
    message: "isSharedはkindが予定のときだけtrueにできます",
    path: ["isShared"],
  });
}

const eventInputSchema = refineIsSharedKind(refineTimeKind(refineRepeatYearlyKind(eventInputBaseSchema)));

export const eventCreateContract = oc.input(eventInputSchema).output(eventSchema).errors({
  FORBIDDEN: {},
  NEEDS_ONBOARDING: { status: 409 },
  INVALID_INPUT: { status: 400 },
});

// event.update: WHERE 句に couple_id を含めた1文で行う（006の post.delete と同じ形）。
// 部分更新にはせず、create と同じ全項目を受け取って置き換える。
// INVALID_INPUT は上記のバリデーションに加え、meetupを既に会った日がある
// 日へ移そうとしたときにも返す（上書きしない。018・architecture.md 5節）
export const eventUpdateContract = oc
  .input(refineIsSharedKind(refineTimeKind(refineRepeatYearlyKind(eventInputBaseSchema.extend({ id: z.string() })))))
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

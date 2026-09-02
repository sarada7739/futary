import { oc } from "@orpc/contract";
import { z } from "zod";

// event.tsのdateSchemaと同じ形（YYYY-MM-DD。architecture.md 4節）
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(DATE_PATTERN, "日付はYYYY-MM-DD形式で指定してください");

// 5段階固定。言葉はタスク定義3節で固定されている
// （1:わるい 2:よくない 3:ふつう 4:よい 5:とてもよい）。範囲は入力だけで
// 判定できるためZodで弾く（BAD_REQUEST。conventions.md 5節）。DB側にも
// 名前付きCHECK（moods_level_range_check）を置く
const levelSchema = z.number().int().min(1).max(5);

const moodEntrySchema = z.object({
  date: dateSchema,
  level: levelSchema,
});

export type MoodEntry = z.infer<typeof moodEntrySchema>;

// 自分の今日の分。upsert（同じ日に2回呼んでも行が増えない。DBの複合主キーで
// 担保。タスク定義8節）。user_idを引数に取らない（ctx.userIdを使う。
// 「渡せないものは、間違えて渡せない」。タスク定義6節）
export const moodSetTodayContract = oc
  .input(z.object({ level: levelSchema }))
  .output(moodEntrySchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
  });

// 自分の今日の分を消す（物理削除。requirements.md 6節の例外。タスク定義7節）。
// 無い日に呼んでも冪等に同じ{date}を返す（消す対象が無いだけで、
// エラーにする理由が無い）
export const moodClearTodayContract = oc.output(z.object({ date: dateSchema })).errors({
  FORBIDDEN: {},
  NEEDS_ONBOARDING: { status: 409 },
});

// mine/partnerを分けて返す。1本の配列にuserIdを混ぜない
// （created_byを返さない方針と同じ。タスク定義9節。混ぜると画面で
// 取り違える）。相手が未参加（ペアが1人）のときはpartnerがnull
// （タスク定義11節「相手の段を出さない」）。
// 範囲は最大400日。event.listと同じ数に揃える（conventions.md 5節
// 「線に合っていないもの」に記載。DBを読まないと分からない条件では
// ないが、event.listと同じ場所に置く）
export const moodListContract = oc
  .input(z.object({ from: dateSchema, to: dateSchema }))
  .output(
    z.object({
      mine: z.array(moodEntrySchema),
      partner: z
        .object({
          name: z.string().nullable(),
          items: z.array(moodEntrySchema),
        })
        .nullable(),
    }),
  )
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    // from > to、または範囲が400日を超える
    INVALID_INPUT: { status: 400 },
  });

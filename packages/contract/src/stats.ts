import { oc } from "@orpc/contract";
import { z } from "zod";

// ペアのメンバー1人分。招待待ちで2人目が未参加のときは1件しか返らない
// （architecture.md 4節「couple_members」。slot は最大2）
export const statsMemberSchema = z.object({
  userId: z.string(),
  // user 行の name/image は理論上 null になり得る（authorName と同じ扱い。
  // architecture.md 5節）
  name: z.string().nullable(),
  image: z.string().nullable(),
});

// 記念日が今日以前なら「付き合って○日目」（当日を1日目とする）、
// 未来の日付なら「あと○日」。人間の決定（012 R経由。「あと◯日の方が親切」）で
// 非表示ではなくこちらを採用した。「負の値を出さない」責任はサーバ側で閉じる
// （クライアントに数値の解釈〈符号判定〉を持たせない。判別可能なunionにすることで
// 「両方null」「両方非null」という無効な状態自体を型で排除している）。
//
// 019でcouples.primary_dateを反映するよう拡張した（Aの決定・PR #123）。
// - dating/dating_upcoming: 旧together/upcoming。「どちらの日に向かっているか」を
//   名前に含めるため改名した（meetupCount→meetupDaysと同じ理由）
// - married: 結婚した日が今日以前。「結婚して○日目」
// - married_upcoming: 結婚した日が未来（結婚式の日が決まっている状態）。
//   「結婚まであと○日」。dating_upcomingだけを先に作って married_upcoming を
//   作らないと「片方だけ修飾された」名前になるため、対で用意する
// - hidden: primary_date='none'のとき。daysを含めない
//   （含めると、非表示にしたはずの数字がレスポンスに乗って開発者ツールから
//   見えてしまう。「恥ずかしいから隠したい」に対して隠れていないことになる）
// - unset: primary_dateが指している方の日付（dating→datingDate・
//   married→marriedDate）がまだ無いとき（023）。hiddenと同じくdaysを
//   含めないが、意味が違う: hiddenは「本人が隠すと決めた」、unsetは
//   「まだ決めていない」。画面はunsetのときだけマイページへの導線を出す
//   （hiddenのときは何も出さない。同じにすると隠すと決めた人に
//   「設定してください」と出し続けることになる）
export const daysTogetherSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("dating"), days: z.number() }),
  z.object({ status: z.literal("dating_upcoming"), days: z.number() }),
  z.object({ status: z.literal("married"), days: z.number() }),
  z.object({ status: z.literal("married_upcoming"), days: z.number() }),
  z.object({ status: z.literal("hidden") }),
  z.object({ status: z.literal("unset") }),
]);

export type DaysTogether = z.infer<typeof daysTogetherSchema>;

export const statsSchema = z.object({
  daysTogether: daysTogetherSchema,
  // 018で「会った日」を1日1件に固定したため、数えているのは回数ではなく
  // 日数になった（`docs/requirements.md` 4節）。フィールド名もそれに揃える
  meetupDays: z.number(),
  postCount: z.number(),
  photoCount: z.number(),
  // slot昇順（1, 2）。1件なら相手が未参加
  members: z.array(statsMemberSchema),
});

export type Stats = z.infer<typeof statsSchema>;

// stats.get: 専用テーブルを持たず、既存テーブルから算出する（architecture.md 4節）。
// ctx.coupleId のみを使い、couple_id を引数に取らない（architecture.md 5節）
export const statsGetContract = oc.output(statsSchema).errors({
  FORBIDDEN: {},
  NEEDS_ONBOARDING: { status: 409 },
});

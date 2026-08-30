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
// 「両方null」「両方非null」という無効な状態自体を型で排除している）
export const daysTogetherSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("together"), days: z.number() }),
  z.object({ status: z.literal("upcoming"), days: z.number() }),
]);

export type DaysTogether = z.infer<typeof daysTogetherSchema>;

export const statsSchema = z.object({
  daysTogether: daysTogetherSchema,
  meetupCount: z.number(),
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

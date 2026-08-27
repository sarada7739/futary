import { oc } from "@orpc/contract";
import { z } from "zod";
import { coupleSchema } from "./couple";

// 招待コードは6桁の英数字（apps/api/src/lib/invite-code.ts の文字集合。
// 紛らわしい 0/O/1/I を除く）。小文字で入力されても受け付けられるよう
// 先に大文字化してから文字集合を検証する
const inviteCodeSchema = z
  .string()
  .length(6, "6桁で指定してください")
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[2-9A-HJ-NP-Z]{6}$/.test(value), {
    message: "使用できない文字が含まれています",
  });

// invite.issue: 自分のペアの招待コードを新規発行する（既存の未使用コードは無効化される）
export const inviteIssueContract = oc
  .output(z.object({ code: z.string(), expiresAt: z.number() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
  });

// invite.accept: コードを受け取ってペアに参加する
export const inviteAcceptContract = oc
  .input(z.object({ code: inviteCodeSchema }))
  .output(coupleSchema)
  .errors({
    // 未認証
    FORBIDDEN: {},
    // コードが無効（存在しない・使用済み・期限切れ・ペアが満員・既に別ペアに所属）。
    // 理由を分けて返すとコードの有効性を外部から判別できてしまうため一本化する
    NOT_FOUND: {},
    // 同一ユーザー/IPからの失敗が閾値を超えた
    RATE_LIMITED: { status: 429 },
  });

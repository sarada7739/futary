import { oc } from "@orpc/contract";
import { z } from "zod";
import { PLAN_SOURCES, PLAN_VALUES } from "./couple";

// 057: 運営の画面（docs/tasks/057-admin.md）。全部 ctx.isAdmin でなければ FORBIDDEN（判定は認可ミドルウェアの
// 1 箇所。admin ルーターの入口で 1 度）。
// 線: 運営が触れるのは数（COUNT）と couple_plans の 1 行だけ。本文・写真・名前・記念日は返さない・書かない
// （security-requirements.md 3節）

// 数 1 つ: 今ある数・今日の増加（JST 0:00 から）・過去 7 日の 1 日平均（今日を含まない直近 7 日 ÷ 7。小数 1 桁）
export const adminCountSchema = z.object({
  total: z.number().int().nonnegative(),
  today: z.number().int().nonnegative(),
  avg7d: z.number().nonnegative(),
});
export type AdminCount = z.infer<typeof adminCountSchema>;

export const ADMIN_STAT_KEYS = ["couples", "users", "paidCouples", "posts", "images"] as const;
export type AdminStatKey = (typeof ADMIN_STAT_KEYS)[number];

export const adminStatsSchema = z.object({
  couples: adminCountSchema,
  users: adminCountSchema,
  paidCouples: adminCountSchema,
  posts: adminCountSchema,
  images: adminCountSchema,
});
export type AdminStats = z.infer<typeof adminStatsSchema>;

const adminErrors = {
  // 運営でない（ゲスト・ADMIN_EMAILS に無い）
  FORBIDDEN: {},
} as const;

// admin.stats: 全体の数（デモペアは除く）。Worker のメモリに 1 分キャッシュ
export const adminStatsContract = oc.input(z.object({})).output(adminStatsSchema).errors(adminErrors);

// admin.lookup: メールの完全一致で 1 人。名前・本文・写真・記念日は返さない（キーはこれで全部）
export const adminLookupUserSchema = z.object({
  email: z.string(),
  createdAt: z.number().int(),
  posts: z.number().int().nonnegative(),
  postImages: z.number().int().nonnegative(),
});
export const adminLookupCoupleSchema = z.object({
  // setPlan に渡すためだけ。画面には出さない
  id: z.string(),
  createdAt: z.number().int(),
  members: z.number().int().nonnegative(),
  plan: z.enum(PLAN_VALUES),
  source: z.enum(PLAN_SOURCES).nullable(),
  expiresAt: z.number().int().nullable(),
  hasStripeCustomer: z.boolean(),
  posts: z.number().int().nonnegative(),
  images: z.number().int().nonnegative(),
  albums: z.number().int().nonnegative(),
});
export const adminLookupSchema = z.object({
  user: adminLookupUserSchema.nullable(),
  couple: adminLookupCoupleSchema.nullable(),
});
export type AdminLookup = z.infer<typeof adminLookupSchema>;

export const adminLookupContract = oc
  .input(z.object({ email: z.string().trim().min(1).max(254) }))
  .output(adminLookupSchema)
  .errors(adminErrors);

// admin.setPlan: paid にする / free に戻す（couple_plans に source='manual' の行を upsert）。
// source='stripe' の行があれば CONFLICT（Stripe のペアは触らない。0節 #9）。全部 admin_actions に残す
export const adminSetPlanContract = oc
  .input(z.object({ coupleId: z.string().min(1), plan: z.enum(PLAN_VALUES) }))
  .output(z.object({ plan: z.enum(PLAN_VALUES) }))
  .errors({
    ...adminErrors,
    // ペアが無い
    NOT_FOUND: {},
    // source='stripe'
    CONFLICT: { status: 409 },
  });

// admin.actions: 直近の操作（新しい順。最大 50）
export const ADMIN_ACTIONS_MAX_LIMIT = 50;
export const ADMIN_ACTIONS_DEFAULT_LIMIT = 20;
export const adminActionSchema = z.object({
  id: z.string(),
  // 退会した運営なら null
  adminEmail: z.string().nullable(),
  action: z.string(),
  coupleId: z.string(),
  // JSON の文字列（前後のプラン）
  detail: z.string(),
  createdAt: z.number().int(),
});
export type AdminAction = z.infer<typeof adminActionSchema>;

export const adminActionsContract = oc
  .input(z.object({ limit: z.number().int().min(1).max(ADMIN_ACTIONS_MAX_LIMIT).optional() }))
  .output(z.object({ items: z.array(adminActionSchema) }))
  .errors(adminErrors);

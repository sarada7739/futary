import { oc } from "@orpc/contract";
import { z } from "zod";

// ADR-006 / architecture.md 5節「探索順」。1〜3は「ちょうど◯前」の日付ぴったり、
// 4は7日以上前からの決定的な1件（apps/api/src/procedures/memory.ts）
export const MEMORY_LABELS = ["oneMonthAgo", "halfYearAgo", "oneYearAgo", "random"] as const;
const memoryLabelSchema = z.enum(MEMORY_LABELS);

// 思い出しカード用の投稿。post.list の postSchema と違い、リアクション・
// 投稿者情報は持たない（カードのデザインに無いため。docs/tasks/013-memory.md）
export const memoryPostSchema = z.object({
  id: z.string(),
  body: z.string(),
  // 画像が無い投稿は null。imageUrl は署名付き GET URL（有効期限1時間。
  // architecture.md 6節。post.list と同じ方針）
  imageUrl: z.string().nullable(),
  imageWidth: z.number().nullable(),
  imageHeight: z.number().nullable(),
  createdAt: z.number(),
});

export const memoryResultSchema = z.object({
  post: memoryPostSchema,
  label: memoryLabelSchema,
});

export type MemoryResult = z.infer<typeof memoryResultSchema>;
export type MemoryLabel = (typeof MEMORY_LABELS)[number];

// memory.get: 専用テーブルを持たず、探索順で最初に見つかった投稿を返す。
// 該当が無ければ null（UIはカードごと非表示）。ctx.coupleId のみを使う
export const memoryGetContract = oc.output(memoryResultSchema.nullable()).errors({
  FORBIDDEN: {},
  NEEDS_ONBOARDING: { status: 409 },
});

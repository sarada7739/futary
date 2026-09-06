import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { couples } from "./couple";

// 037: その期間（月または週）の投稿本文をLLMにまとめさせた結果。期間ごとに
// 1件（作り直すと上書き）。provider/modelを残す（あとで「どのモデルが
// 書いたか」が分からなくならないよう。タスク定義6節）。generatedCountは
// 期間ごと3回までという歯止め（4節）をDB側にも残す。
//
// 【訂正・2026-09-06】当初monthだけの列だったが、人間の「週間も欲しい」
// という要望を受けてperiodKind/periodKeyに直した（Aの判断。まだ本番に
// 出ていない段階だったため、新しい列を足すのではなくこの表自体を書き直した）
export const aiSummaries = sqliteTable(
  "ai_summaries",
  {
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    // 'month' | 'week'
    periodKind: text("period_kind").notNull(),
    // 'YYYY-MM'（月）または'YYYY-Www'（ISO 8601週。JST）
    periodKey: text("period_key").notNull(),
    body: text("body").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    generatedCount: integer("generated_count").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.coupleId, table.periodKind, table.periodKey] }),
    check("ai_summaries_provider_check", sql`${table.provider} IN ('openai', 'anthropic')`),
    check("ai_summaries_period_kind_check", sql`${table.periodKind} IN ('month', 'week')`),
  ],
);

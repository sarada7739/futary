import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { couples } from "./couple";

// 期間（月・週）の投稿本文を LLM にまとめさせた結果。期間ごとに 1 件（作り直すと上書き。037）。
// provider・model を残す（どのモデルが書いたか分からなくならないように）。
// generatedCount は期間ごと 3 回までの歯止め
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

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 記念日・予定・会った日を1テーブルに統合する（ADR-009）。date は YYYY-MM-DD の
// 文字列で持つ（architecture.md 4節: タイムスタンプで持つとタイムゾーンで必ず壊れる）。
// kind に CHECK 制約を置くのは reactions.kind（0006）と同じ理由: 未知の値が
// 1件でも入ると event.list の出力検証（contract の z.enum）全体を巻き込んで壊れる、
// という壊れ方を作らない
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    date: text("date").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    // 記念日（repeat_yearly=1）のみ event.list が年ごとに射影する（architecture.md 5節）
    repeatYearly: integer("repeat_yearly", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // event.list の範囲取得（couple_id 固定 + date 範囲）を支える複合インデックス
    // （architecture.md 4節: INDEX (couple_id, date)）
    index("events_couple_date_idx").on(table.coupleId, table.date),
    check("events_kind_check", sql`${table.kind} IN ('anniversary', 'plan', 'meetup')`),
  ],
);

import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 気分の記録（029）。1 日 1 回、今日の分だけ記録できる。月のマス目の濃さで表す（グラフのライブラリを足さない）。
// 消すのは物理削除（deleted_at を足すと主キーとぶつかり、消した日を再登録できない。requirements.md 6節の例外）
export const moods = sqliteTable(
  "moods",
  {
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // YYYY-MM-DD（JST）の文字列（タイムスタンプだとタイムゾーンで壊れる。architecture.md 4節）
    date: text("date").notNull(),
    level: integer("level").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // 1 日 1 件/人は主キーで担保する（アプリの条件に頼らない）
    primaryKey({ columns: [table.coupleId, table.userId, table.date] }),
    check("moods_level_range_check", sql`${table.level} BETWEEN 1 AND 5`),
  ],
);

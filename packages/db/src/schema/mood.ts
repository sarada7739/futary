import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 029: 気分の記録。1日1回、その日の気分を1タップで残す。折れ線グラフでは
// なく月のマス目に濃さを置いて表す（グラフ描画ライブラリを追加しない。
// タスク定義1節）。今日の分しか記録できない（過去の日には遡れない。5節）。
// 消せるが物理削除（`deleted_at`を足すと主キーと衝突し、消したあと同じ日を
// 再登録できなくなるため。requirements.md 6節の例外。タスク定義7節）
export const moods = sqliteTable(
  "moods",
  {
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // YYYY-MM-DD（JST）。architecture.md 4節「日付はタイムスタンプで持つと
    // タイムゾーンで必ず壊れる」と同じ理由で文字列
    date: text("date").notNull(),
    level: integer("level").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // 「1日1件/人」は主キーで担保する。アプリの条件に頼らない
    // （eventsのmeetup部分UNIQUEと同じ思想。タスク定義8節）
    primaryKey({ columns: [table.coupleId, table.userId, table.date] }),
    check("moods_level_range_check", sql`${table.level} BETWEEN 1 AND 5`),
  ],
);

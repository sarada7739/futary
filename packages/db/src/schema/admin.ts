import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// 057: 運営の操作の記録（タスク定義 0節 #10）。運営が couple_plans を切り替えるたびに 1 行。
// 消す手続きは作らない。退会しても残す（couple_id は消えたペアの id のまま。FK を張らない）。
// detail は JSON（前後のプラン。名前・本文・写真は入れない）
export const adminActions = sqliteTable(
  "admin_actions",
  {
    id: text("id").primaryKey(),
    adminUserId: text("admin_user_id").notNull(),
    // 'plan.set'
    action: text("action").notNull(),
    coupleId: text("couple_id").notNull(),
    detail: text("detail").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  // 直近 N 件（created_at 降順）
  (table) => [index("admin_actions_created_idx").on(table.createdAt)],
);

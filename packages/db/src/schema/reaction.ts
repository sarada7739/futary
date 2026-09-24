import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { posts } from "./post";

// 主キー (post_id, user_id, kind) で、同じ人が同じ投稿に同じ種別を二重に付けられない（architecture.md 4節）。
// kind の CHECK: 未知の種別が 1 件でも入ると post.list の出力検証ごと壊れる
export const reactions = sqliteTable(
  "reactions",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.userId, table.kind] }),
    check("reactions_kind_check", sql`${table.kind} IN ('heart')`),
  ],
);

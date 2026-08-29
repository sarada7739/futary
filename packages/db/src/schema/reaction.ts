import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { posts } from "./post";

// 主キー (post_id, user_id, kind) が「同じユーザーが同じ投稿に同じ種別を
// 二重に付けられない」ことを担保する（architecture.md 4節・タスク009）。
// まず kind = 'heart' の1種のみで運用する（state.md 論点L4）。
// kind に CHECK 制約を置くことで、未知の種別の行が1件でも入ると
// post.list の出力検証（contract の z.enum）全体を巻き込んで壊れる、
// という壊れ方を作らない（M2まとめ監査 Low指摘。architecture.md 4節
// 「起きてはいけない状態は宣言的制約でエラーにする」と同じ方針）
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

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 画像は post_images（1 投稿に 4 枚まで。下の表）
export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    body: text("body").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    // 非 NULL なら論理削除済み
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    // post.list のカーソルページング（couple_id 固定 + created_at 降順。architecture.md 4節）。
    // SQLite は昇順の索引を逆にも辿れるので DESC の指定は要らない
    index("posts_couple_created_idx").on(table.coupleId, table.createdAt),
  ],
);

// 1 投稿に画像 4 枚まで（architecture.md 4節）。position（0..3）が並び順。key があれば実体がある
// （architecture.md 6節）。論理削除を持たない（行が残ると key の UNIQUE が塞がる。post.delete は物理削除）
export const postImages = sqliteTable(
  "post_images",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    position: integer("position").notNull(),
    // 同じ imageId（key）を複数の投稿・行から参照させない
    key: text("key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.position] }),
    unique("post_images_key_unique").on(table.key),
    // 4 枚の上限を position の CHECK と主キーで DB 側にも表す（Zod の max(4) だけに頼らない）
    check("post_images_position_range_check", sql`${table.position} BETWEEN 0 AND 3`),
  ],
);

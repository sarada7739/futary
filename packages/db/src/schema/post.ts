import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 画像アップロード本体は 007 で実装する（architecture.md 6節）。
// この時点の post.create は image_key/image_width/image_height を
// 受け取って保存するだけで、R2 との整合は取らない
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
    imageKey: text("image_key"),
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    // 非NULLなら論理削除済み。post.list は deleted_at IS NULL で絞る
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    // post.list のカーソルページング（couple_id 固定 + created_at 降順）を
    // 支える複合インデックス（architecture.md 4節: INDEX (couple_id, created_at DESC)）。
    // SQLite は昇順インデックスを逆順に辿れるため、DESC 指定なしでも
    // ORDER BY created_at DESC のスキャンに使われる
    index("posts_couple_created_idx").on(table.coupleId, table.createdAt),
  ],
);

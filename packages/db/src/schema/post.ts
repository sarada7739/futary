import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 画像アップロード本体は 007 で実装した（architecture.md 6節）。
// 画像は 031 で post_images へ移した（1投稿に4枚まで。下のテーブル参照）
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

// 031: 1投稿に画像を4枚まで（architecture.md 4節）。position（0..3）が並び順。
// key が非NULL列として存在すれば実体がある、という不変条件は posts.image_key の
// ときと同じ（architecture.md 6節「画像の実体と行の対応を1対1に保つ」）。
// 論理削除を持たせない（posts と違い、行が残ると key の UNIQUE が空きを塞ぐ。
// post.delete は行ごと物理削除する）
export const postImages = sqliteTable(
  "post_images",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    position: integer("position").notNull(),
    // UNIQUE: 同じ imageId（key）を複数の投稿・行から参照させない
    // （posts_image_key_unique が持っていた性質を移した先で失わない）
    key: text("key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.position] }),
    unique("post_images_key_unique").on(table.key),
    // 枚数の上限（4枚）を position の CHECK と主キーで DB 側にも表す。
    // アプリの条件（Zodのmax(4)）だけに頼らない
    check("post_images_position_range_check", sql`${table.position} BETWEEN 0 AND 3`),
  ],
);

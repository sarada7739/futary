import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 画像アップロード本体は 007 で実装した（architecture.md 6節）。
// image_key が非NULLなら R2 に実体がある、という不変条件を保つため、
// post.create が R2 に実体があることを確認してから書く
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
    // UNIQUE: 同じ imageId を複数の投稿から参照させない（architecture.md 6節）。
    // SQLite の UNIQUE インデックスは NULL 同士を区別するため、
    // 画像なしの投稿（NULL）はいくつあっても衝突しない（制約は下の table builder 側）
    imageKey: text("image_key"),
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    // 非NULLなら論理削除済み。post.list は deleted_at IS NULL で絞る。
    // 論理削除後も image_key は消さない（孤児オブジェクトを後から回収できる状態を保つ）
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    // post.list のカーソルページング（couple_id 固定 + created_at 降順）を
    // 支える複合インデックス（architecture.md 4節: INDEX (couple_id, created_at DESC)）。
    // SQLite は昇順インデックスを逆順に辿れるため、DESC 指定なしでも
    // ORDER BY created_at DESC のスキャンに使われる
    index("posts_couple_created_idx").on(table.coupleId, table.createdAt),
    unique("posts_image_key_unique").on(table.imageKey),
  ],
);

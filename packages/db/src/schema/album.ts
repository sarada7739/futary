import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// アルバム。写真はアルバムに直接アップロードする。「タイムライン」のアルバムは行を持たない
// （post_images から毎回引く）。CHECK は持たない（`end_date >= start_date` は入力スキーマで弾く。041）
export const albums = sqliteTable(
  "albums",
  {
    id: text("id").primaryKey(),
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    // 1〜50 文字（trim 後）
    title: text("title").notNull(),
    // 0〜200 文字
    note: text("note").notNull().default(""),
    // YYYY-MM-DD。NULL 可
    startDate: text("start_date"),
    // YYYY-MM-DD。NULL 可。start_date が無いと持てない。start_date 以上（入力で弾く）
    endDate: text("end_date"),
    // カバー（album_photos.id）。NULL なら自動（いちばん新しい写真）。FK は張らず、カバーが外れたら
    // 読む側の 1 箇所で自動に倒す（batch() の順序を気にしなくてよい）
    coverPhotoId: text("cover_photo_id"),
    // 返さない（ふたりとも触れるので canEdit も無い）
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    // 非 NULL なら論理削除済み（architecture.md 4節）
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    // album.list（couple_id 固定 + created_at 降順）
    index("albums_couple_created_idx").on(table.coupleId, table.createdAt),
  ],
);

// アルバムに直接上げた写真。post_images とは別の実体（投稿とアルバムは互いに影響しない）。
// 論理削除を持たない（行が残ると key の UNIQUE が塞がる）
export const albumPhotos = sqliteTable(
  "album_photos",
  {
    // imageId（ULID。サーバが生成）
    id: text("id").primaryKey(),
    albumId: text("album_id")
      .notNull()
      .references(() => albums.id),
    // R2 のキー。サーバだけが組み立てる。UNIQUE で実体と行を 1 対 1 に保ち、非 NULL なら実体がある
    // （architecture.md 6節）
    key: text("key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    // 0〜200 文字。写真ごとの説明文
    caption: text("caption").notNull().default(""),
    // 並び順に使う（追加した時刻）
    takenAt: integer("taken_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    unique("album_photos_key_unique").on(table.key),
    // photo.list（album_id 固定 + taken_at 昇順 + id。同秒でも並びが揺れない）
    index("album_photos_album_taken_idx").on(table.albumId, table.takenAt, table.id),
  ],
);

import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 041: アルバム。イベントごと（京都旅行・誕生日…）に写真をまとめる。写真はアルバムに
// 直接アップロードする（タスク定義0節 #1）。「タイムライン」のアルバム（写真付き投稿の
// 写真が自動で集まる）は行を持たない（仮想。post_images から毎回引く。0節 #4）。
// カラーの列は持たない（人間の指示）。CHECK も持たない（027・040 と同じ。
// `end_date >= start_date` は入力スキーマで弾く）
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
    // カバー（album_photos.id）。NULL なら自動（アルバム内でいちばん新しい写真）。
    // FK は張らない: カバーの写真が外れたときは読む側の 1 箇所で「アルバム内に無ければ
    // 自動」に倒す（D1 の batch() の順序を気にしなくてよい。タスク定義1節）
    coverPhotoId: text("cover_photo_id"),
    // 返さない（wishes と同じ。両方が触れるので canEdit も無い）
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    // 非 NULL なら論理削除済み。album.list / album.get は deleted_at IS NULL で絞る
    // （architecture.md 4節「論理削除を持つ表の規則」）
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    // album.list の取得（couple_id 固定 + created_at 降順）を支える複合インデックス
    index("albums_couple_created_idx").on(table.coupleId, table.createdAt),
  ],
);

// 041: アルバムに直接アップロードした写真。投稿の写真（post_images）とは別の実体で、
// 投稿を消してもアルバムは変わらず、アルバムから外しても投稿は変わらない。
// 論理削除を持たない（外す = 行の物理削除 + R2 の物理削除。post_images と同じ。
// 行が残ると key の UNIQUE が空きを塞ぐ）
export const albumPhotos = sqliteTable(
  "album_photos",
  {
    // imageId（ULID。album.uploadUrl がサーバで生成）と同じ値
    id: text("id").primaryKey(),
    albumId: text("album_id")
      .notNull()
      .references(() => albums.id),
    // R2 のキー（couples/{coupleId}/albums/{id}.jpg）。サーバだけが組み立てる。
    // UNIQUE: 実体と行の対応を 1 対 1 に保つ（post_images.key と同じ理由。
    // architecture.md 6節）。非 NULL なら R2 に実体がある（不変条件）
    key: text("key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    // 0〜200 文字。写真ごとの説明文（タスク定義0節 #7）
    caption: text("caption").notNull().default(""),
    // 並び順に使う。アップロードなら追加した時刻。段階2の複製なら元の投稿の created_at
    takenAt: integer("taken_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    unique("album_photos_key_unique").on(table.key),
    // photo.list（album_id 固定 + taken_at 昇順 + id）を支える複合インデックス。
    // 同秒でも id で並びが揺れない（タスク定義1節「写真の並び順」）
    index("album_photos_album_taken_idx").on(table.albumId, table.takenAt, table.id),
  ],
);

import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 040: ほしいもの。027 の wishes（行きたい場所・食べたいもの。ふたりで共有）とは
// 別の表。主語が本人で、URL と画像を持ち、書けるのは本人だけ（タスク定義0節）。
// wishes に列を足さない（分類を持たないと決めた表に URL・画像・所有者を足すと
// 別物になる）。CHECK は持たない（027 と同じ理由）
export const wants = sqliteTable(
  "wants",
  {
    id: text("id").primaryKey(),
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    // 誰のほしいものか。作成者と同じで、変わらない。ID はレスポンスに出さず
    // isMine / ownerName として返す（タスク定義3節。createdByName と同じ考え方）
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    // 1〜100 文字（trim 後）。URL だけで作ったときは og:title かホスト名が入る
    title: text("title").notNull(),
    // NULL 可。http/https のみ。2048 文字まで。Amazon の /dp/{ASIN} は正規化して保存
    url: text("url"),
    // 0〜200 文字
    note: text("note").notNull().default(""),
    // NULL 可。R2 のキー（couples/{coupleId}/wants/{imageId}.{jpg|png|webp}）。
    // サーバだけが組み立てる。UNIQUE: 実体と行の対応を 1 対 1 に保つ（post_images.key と同じ）。
    // 非 NULL なら R2 に実体がある（architecture.md 6節の不変条件）
    imageKey: text("image_key"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    // 非 NULL なら手に入れた。行は消さない（027 の done_at と同じ）
    obtainedAt: integer("obtained_at", { mode: "timestamp" }),
    // 非 NULL なら論理削除済み。want.list は deleted_at IS NULL で絞る
    // （architecture.md 4節「論理削除を持つ表の規則」）
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    // want.list の取得（couple_id・owner_id 固定 + created_at 降順）を支える複合インデックス
    index("wants_couple_owner_created_idx").on(table.coupleId, table.ownerId, table.createdAt),
    unique("wants_image_key_unique").on(table.imageKey),
  ],
);

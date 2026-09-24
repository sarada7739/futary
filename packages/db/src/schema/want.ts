import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// ほしいもの（040）。wishes（ふたりで共有）とは別の表: 主語が本人で、URL と画像を持ち、書けるのは本人だけ。
// wishes に列を足すと別物になるので足さない。CHECK は持たない
export const wants = sqliteTable(
  "wants",
  {
    id: text("id").primaryKey(),
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    // 誰のほしいものか（作成者で、変わらない）。ID は返さず isMine・ownerName として返す
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    // 1〜100 文字（trim 後）。URL だけで作ったときは og:title かホスト名が入る
    title: text("title").notNull(),
    // NULL 可。http/https のみ。2048 文字まで。Amazon の /dp/{ASIN} は正規化して保存
    url: text("url"),
    // 0〜200 文字
    note: text("note").notNull().default(""),
    // NULL 可。R2 のキー（couples/{coupleId}/wants/{imageId}.{jpg|png|webp}）。サーバだけが組み立てる。
    // UNIQUE で実体と行を 1 対 1 に保ち、非 NULL なら実体がある（architecture.md 6節）
    imageKey: text("image_key"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    // 非 NULL なら手に入れた。行は消さない
    obtainedAt: integer("obtained_at", { mode: "timestamp" }),
    // 非 NULL なら論理削除済み（architecture.md 4節）
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    // want.list（couple_id・owner_id 固定 + created_at 降順）
    index("wants_couple_owner_created_idx").on(table.coupleId, table.ownerId, table.createdAt),
    unique("wants_image_key_unique").on(table.imageKey),
  ],
);

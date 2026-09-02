import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 027: 行きたい場所・食べたいものリスト。分類（kind）を持たない
// （「カフェ」は場所でもあり食べ物でもある。迷わせる分類は書かれない。タスク定義1節）。
// done_by は持たない（画面に出さない列を増やさない）。
// CHECKも持たない（書ける条件が無い。done_at >= created_atは時計のずれで壊れる。
// タスク定義6節）
export const wishes = sqliteTable(
  "wishes",
  {
    id: text("id").primaryKey(),
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    title: text("title").notNull(),
    // 028: 自由記述。0〜200文字（trim後）。一覧にそのまま出す（折りたたまない）
    note: text("note").notNull().default(""),
    // IDはレスポンスに出さない。createdByNameとして名前だけ返す（028。
    // event.createdByNameと同じ形。architecture.md 5節）。編集しても変わらない
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    // 非NULLなら達成済み。達成しても行は消さない（タスク定義2節）
    doneAt: integer("done_at", { mode: "timestamp" }),
    // 非NULLなら論理削除済み。wish.listはdeleted_at IS NULLで絞る
    // （postsと同じ規則。architecture.md 4節「論理削除を持つ表の規則」）
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    // wish.listの取得（couple_id固定+created_at降順）を支える複合インデックス
    // （architecture.md 4節: INDEX (couple_id, created_at DESC)）
    index("wishes_couple_created_idx").on(table.coupleId, table.createdAt),
  ],
);

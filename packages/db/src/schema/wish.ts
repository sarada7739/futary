import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 行きたい場所・食べたいもの（027）。分類を持たない（「カフェ」は場所でも食べ物でもあり、迷わせる分類は
// 書かれない）。done_by は持たない（画面に出さない列を増やさない）。CHECK も持たない
// （done_at >= created_at は時計のずれで壊れる）
export const wishes = sqliteTable(
  "wishes",
  {
    id: text("id").primaryKey(),
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    title: text("title").notNull(),
    // 自由記述。0〜200 文字（trim 後）
    note: text("note").notNull().default(""),
    // ID は返さず表示名だけ返す（architecture.md 5節）。編集しても変わらない
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    // 非 NULL なら達成済み。達成しても行は消さない
    doneAt: integer("done_at", { mode: "timestamp" }),
    // 非 NULL なら論理削除済み（architecture.md 4節）
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    // wish.list（couple_id 固定 + created_at 降順）
    index("wishes_couple_created_idx").on(table.coupleId, table.createdAt),
  ],
);

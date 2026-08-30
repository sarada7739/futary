import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 記念日・予定・会った日を1テーブルに統合する（ADR-009）。date は YYYY-MM-DD の
// 文字列で持つ（architecture.md 4節: タイムスタンプで持つとタイムゾーンで必ず壊れる）。
// kind に CHECK 制約を置くのは reactions.kind（0006）と同じ理由: 未知の値が
// 1件でも入ると event.list の出力検証（contract の z.enum）全体を巻き込んで壊れる、
// という壊れ方を作らない
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    date: text("date").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    // 記念日（repeat_yearly=1）のみ event.list が年ごとに射影する（architecture.md 5節）
    repeatYearly: integer("repeat_yearly", { mode: "boolean" }).notNull().default(false),
    // HH:MM（JSTの壁時計）。任意。anniversary には設定できない（入力スキーマで拒否。
    // architecture.md 5節）。022で time から改名し、CHECK制約でも表す
    startTime: text("start_time"),
    // HH:MM。任意。start_timeが無いと立てられない。start_timeより後（同じ日の中だけ、
    // 日をまたがない）。022で新設（architecture.md 5節）
    endTime: text("end_time"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    // 「ふたりの予定」（021）。kind='plan'のときだけ立てられる。設定者以外は
    // plan を編集・削除できないが、is_shared=1ならどちらでも編集・削除できる
    // （anniversary/meetupはこれまでどおりどちらでも編集・削除できる。変えていない）
    isShared: integer("is_shared", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // event.list の範囲取得（couple_id 固定 + date 範囲）を支える複合インデックス
    // （architecture.md 4節: INDEX (couple_id, date)）
    index("events_couple_date_idx").on(table.coupleId, table.date),
    check("events_kind_check", sql`${table.kind} IN ('anniversary', 'plan', 'meetup')`),
    // 会った日（meetup）は1日1件。複数行の関係なのでCHECKではなく部分UNIQUE
    // インデックスで表す（architecture.md 5節。posts.image_keyのUNIQUEと同じ方針）
    uniqueIndex("events_meetup_unique").on(table.coupleId, table.date).where(sql`${table.kind} = 'meetup'`),
    // is_sharedはkind='plan'のときだけ立てられる（021タスク定義）。eventsは
    // 他テーブルからFK参照される親テーブルではないため、D1の「テーブルを
    // 作り直す」形のCHECK追加マイグレーションがそのまま通る（architecture.md
    // 4節のcouplesの制約とは異なる。TRIGGERへの回避は不要）
    check("events_is_shared_check", sql`${table.isShared} = 0 OR ${table.kind} = 'plan'`),
    // start_timeはkindがanniversary以外のときだけ設定できる（旧timeのCHECKを022で新設。
    // 入力スキーマのrefineTimeKindと同じ判断をDB側でも表す。architecture.md 5節）
    check("events_start_time_check", sql`${table.startTime} IS NULL OR ${table.kind} <> 'anniversary'`),
    // end_timeはstart_timeが無いと立てられない（022。入力スキーマでも拒む）
    check(
      "events_end_time_requires_start_check",
      sql`${table.endTime} IS NULL OR ${table.startTime} IS NOT NULL`,
    ),
    // 終了は開始より後。同じ日の中だけで日をまたがない（022）
    check("events_end_time_after_start_check", sql`${table.endTime} IS NULL OR ${table.endTime} > ${table.startTime}`),
  ],
);

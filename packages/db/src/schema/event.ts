import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { couples } from "./couple";

// 記念日・予定・会った日を 1 つの表にする（ADR-009）。date は YYYY-MM-DD の文字列で持つ
// （タイムスタンプだとタイムゾーンで必ず壊れる。architecture.md 4節）。
// kind の CHECK: 未知の値が 1 件でも入ると event.list の出力検証ごと壊れる
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
    // 記念日（repeat_yearly=1）だけ event.list が年ごとに射影する（architecture.md 5節）
    repeatYearly: integer("repeat_yearly", { mode: "boolean" }).notNull().default(false),
    // HH:MM（JST の壁時計）。任意。記念日には設定できない
    startTime: text("start_time"),
    // HH:MM。任意。start_time が要り、それより後（同じ日の中だけ。日をまたがない）
    endTime: text("end_time"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    // 「ふたりの予定」。plan のときだけ立てられる。plan は設定者だけが編集・削除でき、
    // is_shared=1 ならどちらでもできる（記念日・会った日はどちらでもできる。021）
    isShared: integer("is_shared", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // event.list の範囲取得（couple_id 固定 + date 範囲。architecture.md 4節）
    index("events_couple_date_idx").on(table.coupleId, table.date),
    check("events_kind_check", sql`${table.kind} IN ('anniversary', 'plan', 'meetup')`),
    // repeat_yearly は記念日のときだけ。シードのような契約を通らない書き込み口も DB で塞ぐ（architecture.md 4節）
    check("events_repeat_yearly_check", sql`${table.repeatYearly} = 0 OR ${table.kind} = 'anniversary'`),
    // 会った日は 1 日 1 件。複数行の関係なので CHECK ではなく部分 UNIQUE インデックス
    uniqueIndex("events_meetup_unique").on(table.coupleId, table.date).where(sql`${table.kind} = 'meetup'`),
    // is_shared は plan のときだけ。events は子表を持たないので、作り直しの形の CHECK 追加がそのまま通る
    // （couples と違い TRIGGER は要らない。architecture.md 4節）
    check("events_is_shared_check", sql`${table.isShared} = 0 OR ${table.kind} = 'plan'`),
    // start_time は記念日以外のときだけ（入力スキーマと同じ判断を DB でも表す）
    check("events_start_time_check", sql`${table.startTime} IS NULL OR ${table.kind} <> 'anniversary'`),
    // end_time は start_time が無いと立てられない
    check(
      "events_end_time_requires_start_check",
      sql`${table.endTime} IS NULL OR ${table.startTime} IS NOT NULL`,
    ),
    // 終了は開始より後（同じ日の中だけ）
    check("events_end_time_after_start_check", sql`${table.endTime} IS NULL OR ${table.endTime} > ${table.startTime}`),
  ],
);

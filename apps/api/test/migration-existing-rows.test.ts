import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/index";

const db = (env as unknown as Bindings).DB;
type Migration = Parameters<typeof applyD1Migrations>[1][number];
const TEST_MIGRATIONS = (env as unknown as { TEST_MIGRATIONS: Migration[] }).TEST_MIGRATIONS;

// conventions.md 6節「既存行の扱いが変わるマイグレーションは、行を入れた状態で
// 当てる」。0011（eventsのtimeをstart_timeへ改名し、end_timeを追加する）が、
// この規約が実際に効く最初の回である（022・Rの提案）。
//
// setupFile（apply-migrations.ts）がテスト開始前に全マイグレーションを
// 適用済みのため、0011だけをd1_migrationsの記録から外し、eventsテーブルを
// 0010時点の構造（time列を持つ。0010_event_is_shared.sqlの__new_eventsと同じ）へ
// 一時的に戻してから、本物の0011_event_start_end_time.sqlを再適用する。
// 書き写しではなく実物のファイルを通す（0008は書き写しに留まった。architecture.md 4節）
describe("0011マイグレーション: 既存行のtimeがstart_timeへ引き継がれる", () => {
  it("time列に値が入った既存行が、start_timeへそのまま移り、end_timeはNULLになる", async () => {
    const target = TEST_MIGRATIONS.find((m) => m.name === "0011_event_start_end_time.sql");
    if (!target) throw new Error("0011のマイグレーションがTEST_MIGRATIONSに見つかりません");

    const userId = crypto.randomUUID();
    const coupleId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'テスト', ?2, 1, ?3, ?3)",
      )
      .bind(userId, `${crypto.randomUUID()}@example.com`, now)
      .run();
    await db
      .prepare("INSERT INTO couples (id, anniversary_date, created_at) VALUES (?1, '2020-01-01', ?2)")
      .bind(coupleId, now)
      .run();

    // 0011適用後（現在）のevents構造を退避し、0010時点の構造を一時的に再現する。
    // インデックスはテーブルをリネームしても同じ名前のまま残るため、0011のSQLが
    // 同名のCREATE INDEXを実行できるよう一旦落としておく（後片付けで作り直す）。
    // D1のexec()は改行区切りで文を解釈するため、CREATE TABLE文は1行にまとめる
    await db.exec(`ALTER TABLE events RENAME TO events_after_0011`);
    await db.exec(`DROP INDEX events_couple_date_idx`);
    await db.exec(`DROP INDEX events_meetup_unique`);
    await db.exec(
      `CREATE TABLE events (id text PRIMARY KEY NOT NULL, couple_id text NOT NULL, date text NOT NULL, title text NOT NULL, kind text NOT NULL, repeat_yearly integer DEFAULT false NOT NULL, time text, created_by text NOT NULL, is_shared integer DEFAULT false NOT NULL, created_at integer NOT NULL, FOREIGN KEY (couple_id) REFERENCES couples(id) ON UPDATE no action ON DELETE no action, FOREIGN KEY (created_by) REFERENCES user(id) ON UPDATE no action ON DELETE no action, CONSTRAINT "events_kind_check" CHECK(kind IN ('anniversary', 'plan', 'meetup')), CONSTRAINT "events_is_shared_check" CHECK(is_shared = 0 OR kind = 'plan'))`,
    );

    const eventId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO events (id, couple_id, date, title, kind, repeat_yearly, time, created_by, is_shared, created_at)
         VALUES (?1, ?2, '2026-03-10', '既存の予定', 'plan', 0, '12:07', ?3, 0, ?4)`,
      )
      .bind(eventId, coupleId, userId, now)
      .run();

    // d1_migrationsの記録を消し、0011を「未適用」に戻してから、本物のSQLファイルで再適用する
    await db.prepare(`DELETE FROM d1_migrations WHERE name = ?1`).bind(target.name).run();
    try {
      await applyD1Migrations(db, [target]);

      const row = await db
        .prepare(`SELECT start_time AS start_time, end_time AS end_time FROM events WHERE id = ?1`)
        .bind(eventId)
        .first<{ start_time: string | null; end_time: string | null }>();

      expect(row?.start_time).toBe("12:07");
      expect(row?.end_time).toBeNull();
    } finally {
      // 後片付け: このテストで作ったevents（索引ごと）を消し、退避しておいた
      // 本来のevents（0011適用後の構造）を戻して索引も作り直す
      await db.exec(`DROP TABLE IF EXISTS events`);
      await db.exec(`ALTER TABLE events_after_0011 RENAME TO events`);
      await db.exec(`CREATE INDEX events_couple_date_idx ON events (couple_id,date)`);
      await db.exec(`CREATE UNIQUE INDEX events_meetup_unique ON events (couple_id,date) WHERE "events"."kind" = 'meetup'`);
      await db.prepare(`INSERT OR IGNORE INTO d1_migrations (name) VALUES (?1)`).bind(target.name).run();
    }
  });
});

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
// 0010時点の構造へ一時的に戻してから、本物の0011_event_start_end_time.sqlを
// 再適用する。0011は実ファイルを通しているが、その出発点である「0010時点の
// events」はこのテスト内に手で書き写している（下のCREATE TABLE文）。
// 0010を変えたときは、この写しも直す（Rレビュー指摘。0008の_dedupe_testと
// 半分同じ形が残っている）
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
      .prepare("INSERT INTO couples (id, dating_date, created_at) VALUES (?1, '2020-01-01', ?2)")
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
      // 本来のevents（0011適用後の構造）を戻して索引も作り直す。この2本の
      // CREATE INDEXも手書きの写しである。索引の定義が変わったら、ここも直す
      // （Rレビュー指摘。いまはテストが1件だけなので実害はない）
      await db.exec(`DROP TABLE IF EXISTS events`);
      await db.exec(`ALTER TABLE events_after_0011 RENAME TO events`);
      await db.exec(`CREATE INDEX events_couple_date_idx ON events (couple_id,date)`);
      await db.exec(`CREATE UNIQUE INDEX events_meetup_unique ON events (couple_id,date) WHERE "events"."kind" = 'meetup'`);
      await db.prepare(`INSERT OR IGNORE INTO d1_migrations (name) VALUES (?1)`).bind(target.name).run();
    }
  });
});

// 023: couples.anniversary_date（NOT NULL）をdating_date（NULL許容）へ改名した。
// couplesは複数の子テーブルから参照される親テーブルのため、0011のevents同様に
// 「行を入れた状態で当てる」テストが要る（conventions.md 6節）
describe("0012マイグレーション: 既存行のanniversary_dateがdating_dateへ引き継がれる", () => {
  it("anniversary_dateに値が入った既存行が、dating_dateへそのまま移る", async () => {
    const target = TEST_MIGRATIONS.find((m) => m.name === "0012_couple_dating_date_optional.sql");
    if (!target) throw new Error("0012のマイグレーションがTEST_MIGRATIONSに見つかりません");

    const coupleId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    // 0012適用後（現在）のcouples構造を退避し、0011時点の構造
    // （anniversary_date NOT NULL・dating_date無し）を一時的に再現する
    await db.exec(`ALTER TABLE couples RENAME TO couples_after_0012`);
    await db.exec(`DROP TRIGGER couples_married_after_anniversary_insert`);
    await db.exec(`DROP TRIGGER couples_married_after_anniversary_update`);
    await db.exec(
      `CREATE TABLE couples (id text PRIMARY KEY NOT NULL, anniversary_date text NOT NULL, is_demo integer DEFAULT false NOT NULL, created_at integer NOT NULL, married_date text, primary_date text DEFAULT 'dating' NOT NULL CHECK("primary_date" IN ('dating', 'married', 'none')))`,
    );
    await db.exec(
      `CREATE TRIGGER couples_married_after_anniversary_insert BEFORE INSERT ON couples WHEN NEW.married_date IS NOT NULL AND NEW.married_date < NEW.anniversary_date BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: couples_married_after_anniversary'); END`,
    );
    await db.exec(
      `CREATE TRIGGER couples_married_after_anniversary_update BEFORE UPDATE ON couples WHEN NEW.married_date IS NOT NULL AND NEW.married_date < NEW.anniversary_date BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: couples_married_after_anniversary'); END`,
    );

    await db
      .prepare(`INSERT INTO couples (id, anniversary_date, is_demo, created_at) VALUES (?1, '2018-05-20', 0, ?2)`)
      .bind(coupleId, now)
      .run();

    // d1_migrationsの記録を消し、0012を「未適用」に戻してから、本物のSQLファイルで再適用する
    await db.prepare(`DELETE FROM d1_migrations WHERE name = ?1`).bind(target.name).run();
    try {
      await applyD1Migrations(db, [target]);

      const row = await db
        .prepare(`SELECT dating_date AS dating_date FROM couples WHERE id = ?1`)
        .bind(coupleId)
        .first<{ dating_date: string | null }>();

      expect(row?.dating_date).toBe("2018-05-20");
    } finally {
      // 後片付け: このテストで作ったcouples（TRIGGERごと）を消し、退避しておいた
      // 本来のcouples（0012適用後の構造）を戻す。TRIGGER名はDB全体で一意なため、
      // 退避前に一度落としている（上）。同じ名前で作り直す
      // （0011テストのCREATE INDEXの後片付けと同じ形。Rレビュー指摘。
      // インデックス同様、このTRIGGERの定義が変わったらここも直す）
      await db.exec(`DROP TABLE IF EXISTS couples`);
      await db.exec(`ALTER TABLE couples_after_0012 RENAME TO couples`);
      await db.exec(
        `CREATE TRIGGER couples_married_after_anniversary_insert BEFORE INSERT ON couples WHEN NEW.married_date IS NOT NULL AND NEW.dating_date IS NOT NULL AND NEW.married_date < NEW.dating_date BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: couples_married_after_anniversary'); END`,
      );
      await db.exec(
        `CREATE TRIGGER couples_married_after_anniversary_update BEFORE UPDATE ON couples WHEN NEW.married_date IS NOT NULL AND NEW.dating_date IS NOT NULL AND NEW.married_date < NEW.dating_date BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: couples_married_after_anniversary'); END`,
      );
      await db.prepare(`INSERT OR IGNORE INTO d1_migrations (name) VALUES (?1)`).bind(target.name).run();
    }
  });
});

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

// 014: events_repeat_yearly_checkを足す。018で入れたつもりで実際には
// 入っていなかった制約（Rが実測）。既存の（制約通りの）行が表の作り直しを
// 生き延びることを確認する。0011・0012と同じ形
describe("0013マイグレーション: 既存行がevents_repeat_yearly_checkの追加を生き延びる", () => {
  it("repeat_yearly=1のanniversaryとrepeat_yearly=0のmeetupが、値そのままで残る", async () => {
    const target = TEST_MIGRATIONS.find((m) => m.name === "0013_event_repeat_yearly_check.sql");
    if (!target) throw new Error("0013のマイグレーションがTEST_MIGRATIONSに見つかりません");

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

    // 0013適用後（現在）のevents構造を退避し、0012時点の構造
    // （events_repeat_yearly_check無し）を一時的に再現する
    await db.exec(`ALTER TABLE events RENAME TO events_after_0013`);
    await db.exec(`DROP INDEX events_couple_date_idx`);
    await db.exec(`DROP INDEX events_meetup_unique`);
    await db.exec(
      `CREATE TABLE events (id text PRIMARY KEY NOT NULL, couple_id text NOT NULL, date text NOT NULL, title text NOT NULL, kind text NOT NULL, repeat_yearly integer DEFAULT false NOT NULL, start_time text, end_time text, created_by text NOT NULL, is_shared integer DEFAULT false NOT NULL, created_at integer NOT NULL, FOREIGN KEY (couple_id) REFERENCES couples(id) ON UPDATE no action ON DELETE no action, FOREIGN KEY (created_by) REFERENCES user(id) ON UPDATE no action ON DELETE no action, CONSTRAINT "events_kind_check" CHECK(kind IN ('anniversary', 'plan', 'meetup')), CONSTRAINT "events_is_shared_check" CHECK(is_shared = 0 OR kind = 'plan'), CONSTRAINT "events_start_time_check" CHECK(start_time IS NULL OR kind <> 'anniversary'), CONSTRAINT "events_end_time_requires_start_check" CHECK(end_time IS NULL OR start_time IS NOT NULL), CONSTRAINT "events_end_time_after_start_check" CHECK(end_time IS NULL OR end_time > start_time))`,
    );

    const anniversaryId = crypto.randomUUID();
    const meetupId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO events (id, couple_id, date, title, kind, repeat_yearly, created_by, is_shared, created_at)
         VALUES (?1, ?2, '2020-05-20', '付き合った記念日', 'anniversary', 1, ?3, 0, ?4)`,
      )
      .bind(anniversaryId, coupleId, userId, now)
      .run();
    await db
      .prepare(
        `INSERT INTO events (id, couple_id, date, title, kind, repeat_yearly, created_by, is_shared, created_at)
         VALUES (?1, ?2, '2026-03-10', '会った日', 'meetup', 0, ?3, 0, ?4)`,
      )
      .bind(meetupId, coupleId, userId, now)
      .run();

    // d1_migrationsの記録を消し、0013を「未適用」に戻してから、本物のSQLファイルで再適用する
    await db.prepare(`DELETE FROM d1_migrations WHERE name = ?1`).bind(target.name).run();
    try {
      await applyD1Migrations(db, [target]);

      const rows = await db
        .prepare(`SELECT id AS id, kind AS kind, repeat_yearly AS repeat_yearly FROM events WHERE id IN (?1, ?2)`)
        .bind(anniversaryId, meetupId)
        .all<{ id: string; kind: string; repeat_yearly: number }>();

      const anniversary = rows.results.find((r) => r.id === anniversaryId);
      const meetup = rows.results.find((r) => r.id === meetupId);
      expect(anniversary?.kind).toBe("anniversary");
      expect(anniversary?.repeat_yearly).toBe(1);
      expect(meetup?.kind).toBe("meetup");
      expect(meetup?.repeat_yearly).toBe(0);

      // 制約自体も生きていることを確認する（repeat_yearly=1のmeetupは拒否される）
      await expect(
        db
          .prepare(
            `INSERT INTO events (id, couple_id, date, title, kind, repeat_yearly, created_by, is_shared, created_at)
             VALUES (?1, ?2, '2026-04-01', '違反行', 'meetup', 1, ?3, 0, ?4)`,
          )
          .bind(crypto.randomUUID(), coupleId, userId, now)
          .run(),
      ).rejects.toThrow();
    } finally {
      // 後片付け: このテストで作ったevents（索引ごと）を消し、退避しておいた
      // 本来のevents（0013適用後の構造）を戻して索引も作り直す
      await db.exec(`DROP TABLE IF EXISTS events`);
      await db.exec(`ALTER TABLE events_after_0013 RENAME TO events`);
      await db.exec(`CREATE INDEX events_couple_date_idx ON events (couple_id,date)`);
      await db.exec(`CREATE UNIQUE INDEX events_meetup_unique ON events (couple_id,date) WHERE "events"."kind" = 'meetup'`);
      await db.prepare(`INSERT OR IGNORE INTO d1_migrations (name) VALUES (?1)`).bind(target.name).run();
    }
  });
});

// 024: invite_failuresのキーをuser_idからaccount_hashへ差し替えた（Aの決定。
// packages/db/src/schema/couple.tsのinviteFailuresコメント参照）。0014で
// user_idを列ごと落とし、0015でNOT NULLのaccount_hashを足す。0015のADD COLUMNは
// 既存行があるとNOT NULLを付けられない（SQLiteの制約）ため、先にDELETEで
// 空にしてから足す設計にした。「既存行が失われる」こと自体が0015の仕様の
// 一部なので、それが実際に起きることをここで確かめる
describe("0014・0015マイグレーション: 既存行はaccount_hash追加のために一度空になる", () => {
  it("user_id方式の既存行は残らず、account_hashがNOT NULLとして機能する", async () => {
    const target14 = TEST_MIGRATIONS.find((m) => m.name === "0014_invite_failures_drop_user_id.sql");
    const target15 = TEST_MIGRATIONS.find((m) => m.name === "0015_invite_failures_add_account_hash.sql");
    if (!target14 || !target15) {
      throw new Error("0014/0015のマイグレーションがTEST_MIGRATIONSに見つかりません");
    }

    const userId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'テスト', ?2, 1, ?3, ?3)",
      )
      .bind(userId, `${crypto.randomUUID()}@example.com`, now)
      .run();

    // 0013時点（現状の直前の形）のinvite_failures構造を退避し、user_id方式を再現する
    await db.exec(`ALTER TABLE invite_failures RENAME TO invite_failures_after_0015`);
    await db.exec(`DROP INDEX invite_failures_account_created_idx`);
    await db.exec(`DROP INDEX invite_failures_ip_created_idx`);
    await db.exec(
      `CREATE TABLE invite_failures (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, user_id text NOT NULL, ip_address text, created_at integer NOT NULL, FOREIGN KEY (user_id) REFERENCES user(id) ON UPDATE no action ON DELETE no action)`,
    );
    await db.exec(`CREATE INDEX invite_failures_user_created_idx ON invite_failures (user_id,created_at)`);
    await db.exec(`CREATE INDEX invite_failures_ip_created_idx ON invite_failures (ip_address,created_at)`);

    await db
      .prepare(`INSERT INTO invite_failures (user_id, ip_address, created_at) VALUES (?1, ?2, ?3)`)
      .bind(userId, "203.0.113.9", now)
      .run();

    await db.prepare(`DELETE FROM d1_migrations WHERE name IN (?1, ?2)`).bind(target14.name, target15.name).run();
    try {
      await applyD1Migrations(db, [target14, target15]);

      // 0015が「NOT NULL列を足す前に空にする」ため、user_id方式の既存行は残らない
      const remaining = await db
        .prepare(`SELECT COUNT(*) AS count FROM invite_failures`)
        .first<{ count: number }>();
      expect(remaining?.count).toBe(0);

      const columns = await db.prepare(`PRAGMA table_info(invite_failures)`).all<{ name: string }>();
      const columnNames = columns.results.map((c) => c.name);
      expect(columnNames).not.toContain("user_id");
      expect(columnNames).toContain("account_hash");

      // account_hashがNOT NULLとして機能している（省略するとエラーになる）
      await expect(
        db
          .prepare(`INSERT INTO invite_failures (ip_address, created_at) VALUES (?1, ?2)`)
          .bind("203.0.113.9", now)
          .run(),
      ).rejects.toThrow();

      // 新しい形（account_hash付き）では通る
      await expect(
        db
          .prepare(`INSERT INTO invite_failures (account_hash, ip_address, created_at) VALUES (?1, ?2, ?3)`)
          .bind("test-hash", "203.0.113.9", now)
          .run(),
      ).resolves.toBeTruthy();
    } finally {
      // 後片付け: このテストで作ったinvite_failures（索引ごと）を消し、退避しておいた
      // 本来のinvite_failures（0015適用後の構造）を戻して索引も作り直す
      await db.exec(`DROP TABLE IF EXISTS invite_failures`);
      await db.exec(`ALTER TABLE invite_failures_after_0015 RENAME TO invite_failures`);
      await db.exec(`CREATE INDEX invite_failures_account_created_idx ON invite_failures (account_hash,created_at)`);
      await db.exec(`CREATE INDEX invite_failures_ip_created_idx ON invite_failures (ip_address,created_at)`);
      await db.prepare(`INSERT OR IGNORE INTO d1_migrations (name) VALUES (?1)`).bind(target14.name).run();
      await db.prepare(`INSERT OR IGNORE INTO d1_migrations (name) VALUES (?1)`).bind(target15.name).run();
    }
  });
});

// 028: wishesはFK参照される親テーブルでもなく、0017は`ALTER TABLE ... ADD
// COLUMN`一本の単純な追加であるため、0011・0012のような「表を作り直す」形の
// 退避・復元は要らない（タスク定義5節「行を消さない。件数を数える手順は
// 要らない」）。note列だけを一時的に落として0016時点の構造を再現する
describe("0017マイグレーション: 既存行がnote列の追加を生き延び、noteは空文字になる", () => {
  it("note列を持たない既存行に0017を当てると、noteが空文字で読める", async () => {
    const target = TEST_MIGRATIONS.find((m) => m.name === "0017_wishes_note.sql");
    if (!target) throw new Error("0017のマイグレーションがTEST_MIGRATIONSに見つかりません");

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

    // 0017適用後（現在）のnote列を一時的に落とし、0016時点の構造を再現する
    await db.exec(`ALTER TABLE wishes DROP COLUMN note`);

    const wishId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO wishes (id, couple_id, title, created_by, created_at) VALUES (?1, ?2, '既存の行きたい場所', ?3, ?4)`,
      )
      .bind(wishId, coupleId, userId, now)
      .run();

    // d1_migrationsの記録を消し、0017を「未適用」に戻してから、本物のSQLファイルで再適用する
    await db.prepare(`DELETE FROM d1_migrations WHERE name = ?1`).bind(target.name).run();
    await applyD1Migrations(db, [target]);

    const row = await db
      .prepare(`SELECT note AS note FROM wishes WHERE id = ?1`)
      .bind(wishId)
      .first<{ note: string }>();
    expect(row?.note).toBe("");
  });
});

// 031: posts.image_key は posts_image_key_unique（UNIQUEインデックス）に
// 使われている。SQLiteは索引に使われている列をDROP COLUMNできないため、
// 0019_post_images.sqlはDROP INDEX → DROP COLUMNの順で書いた。
// 「通るはずだ」で進めず、順序を飛ばすと実際に落ちることをここで実測する
// （023がcouplesで同じことをやっている。docs/tasks/031-multi-image.md 4節）
describe("0019マイグレーション: DROP INDEXを飛ばすとDROP COLUMNが落ちる（手順の根拠）", () => {
  it("posts_image_key_unique が残ったままだと image_key のDROP COLUMNが失敗し、DROP INDEX後は成功する", async () => {
    // 0019適用後（現在）のpostsはimage_key列を持たないため、一時的に足し戻して
    // 索引ありの状態を再現する
    await db.exec(`ALTER TABLE posts ADD COLUMN image_key text`);
    await db.exec(`CREATE UNIQUE INDEX posts_image_key_unique ON posts (image_key)`);

    try {
      // 索引が残ったままのDROP COLUMNは失敗する（実測。手順の根拠）
      await expect(db.exec(`ALTER TABLE posts DROP COLUMN image_key`)).rejects.toThrow();

      // DROP INDEXしてからなら成功する
      await db.exec(`DROP INDEX posts_image_key_unique`);
      await expect(db.exec(`ALTER TABLE posts DROP COLUMN image_key`)).resolves.not.toThrow();
    } finally {
      // 後片付け: 失敗せずに終わった場合に備え、両方とも存在しない状態に揃える
      const columns = await db.prepare(`PRAGMA table_info(posts)`).all<{ name: string }>();
      if (columns.results.some((c) => c.name === "image_key")) {
        await db.exec(`ALTER TABLE posts DROP COLUMN image_key`).catch(() => {});
      }
      const indexes = await db
        .prepare(`SELECT name AS name FROM sqlite_master WHERE type = 'index' AND name = 'posts_image_key_unique'`)
        .all<{ name: string }>();
      if (indexes.results.length > 0) {
        await db.exec(`DROP INDEX posts_image_key_unique`).catch(() => {});
      }
    }
  });
});

// 031: 既存の1枚（posts.image_key）がpost_imagesのposition=0へ移ることを、
// 実際に行を入れた状態でマイグレーションを当てて確認する（conventions.md 6節）。
// postsはcouples/eventsと違い表を作り直さない（列を足し戻すだけで0018時点の
// 構造を再現できる。0017テストと同じ簡潔な形）
describe("0019マイグレーション: 既存の1枚がpost_imagesのposition=0へ移る", () => {
  it("posts.image_keyに値が入った既存行が、post_images(position=0)へそのまま移り、posts側の列は消える", async () => {
    const target = TEST_MIGRATIONS.find((m) => m.name === "0019_post_images.sql");
    if (!target) throw new Error("0019のマイグレーションがTEST_MIGRATIONSに見つかりません");

    const userId = crypto.randomUUID();
    const coupleId = crypto.randomUUID();
    const postId = crypto.randomUUID();
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

    // 0019適用後（現在）はpost_imagesが実表であり、postsはimage_key等を
    // 持たない。0018時点の構造（image_key/width/height列+UNIQUE索引、
    // post_images無し）を一時的に再現する
    await db.exec(`DROP TABLE post_images`);
    await db.exec(`ALTER TABLE posts ADD COLUMN image_key text`);
    await db.exec(`ALTER TABLE posts ADD COLUMN image_width integer`);
    await db.exec(`ALTER TABLE posts ADD COLUMN image_height integer`);
    await db.exec(`CREATE UNIQUE INDEX posts_image_key_unique ON posts (image_key)`);

    const imageKey = `couples/${coupleId}/posts/${crypto.randomUUID()}.jpg`;
    await db
      .prepare(
        `INSERT INTO posts (id, couple_id, author_id, body, image_key, image_width, image_height, created_at)
         VALUES (?1, ?2, ?3, '既存の投稿', ?4, 1600, 1200, ?5)`,
      )
      .bind(postId, coupleId, userId, imageKey, now)
      .run();

    // 031・security-auditor指摘: 007の旧設計は論理削除後もimage_keyを残していた
    // ため、既に論理削除済みの投稿が画像付きのままDBに残っている状態がありうる。
    // これをpost_imagesへ移してしまうと、031の新しい不変条件（論理削除済みの
    // 投稿はpost_imagesを持たない。post.deleteが物理削除する）と矛盾した状態を
    // 移行直後から作ってしまうため、移さないことを確認する
    const deletedPostId = crypto.randomUUID();
    const deletedImageKey = `couples/${coupleId}/posts/${crypto.randomUUID()}.jpg`;
    await db
      .prepare(
        `INSERT INTO posts (id, couple_id, author_id, body, image_key, image_width, image_height, created_at, deleted_at)
         VALUES (?1, ?2, ?3, '削除済みの投稿', ?4, 800, 600, ?5, ?5)`,
      )
      .bind(deletedPostId, coupleId, userId, deletedImageKey, now)
      .run();

    // d1_migrationsの記録を消し、0019を「未適用」に戻してから、本物のSQLファイルで再適用する
    await db.prepare(`DELETE FROM d1_migrations WHERE name = ?1`).bind(target.name).run();
    await applyD1Migrations(db, [target]);

    const imageRow = await db
      .prepare(
        `SELECT position AS position, key AS key, width AS width, height AS height
           FROM post_images WHERE post_id = ?1`,
      )
      .bind(postId)
      .first<{ position: number; key: string; width: number; height: number }>();
    expect(imageRow?.position).toBe(0);
    expect(imageRow?.key).toBe(imageKey);
    expect(imageRow?.width).toBe(1600);
    expect(imageRow?.height).toBe(1200);

    const deletedImageRow = await db
      .prepare(`SELECT 1 FROM post_images WHERE post_id = ?1`)
      .bind(deletedPostId)
      .first();
    expect(deletedImageRow).toBeNull();

    const columns = await db.prepare(`PRAGMA table_info(posts)`).all<{ name: string }>();
    const columnNames = columns.results.map((c) => c.name);
    expect(columnNames).not.toContain("image_key");
    expect(columnNames).not.toContain("image_width");
    expect(columnNames).not.toContain("image_height");
  });
});

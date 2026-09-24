import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/index";

const db = (env as unknown as Bindings).DB;
type Migration = Parameters<typeof applyD1Migrations>[1][number];
const TEST_MIGRATIONS = (env as unknown as { TEST_MIGRATIONS: Migration[] }).TEST_MIGRATIONS;

// conventions.md 6節「既存行の扱いが変わるマイグレーションは、行を入れた状態で当てる」。
// 0011（events の time を start_time へ改名し、end_time を追加）が対象。
//
// setupFile（apply-migrations.ts）が全マイグレーションを適用済みなので、0011 だけを d1_migrations
// の記録から外し、events を 0010 時点の構造へ一時的に戻してから本物の 0011 を再適用する。
// 出発点の「0010 時点の events」は下の CREATE TABLE に手で写している。0010 を変えたらこれも直す
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

    // 0011 適用後の events を退避し、0010 時点の構造を再現する。索引はテーブルを改名しても同じ名前で
    // 残るので、0011 の CREATE INDEX が通るよう一旦落とす（後片付けで作り直す）。
    // D1 の exec() は改行で文を区切るので、CREATE TABLE は 1 行にまとめる
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
      // 後片付け: 作った events（索引ごと）を消し、退避した本来の events を戻して索引を作り直す。
      // この CREATE INDEX も手書きの写しなので、索引の定義が変わったらここも直す
      await db.exec(`DROP TABLE IF EXISTS events`);
      await db.exec(`ALTER TABLE events_after_0011 RENAME TO events`);
      await db.exec(`CREATE INDEX events_couple_date_idx ON events (couple_id,date)`);
      await db.exec(`CREATE UNIQUE INDEX events_meetup_unique ON events (couple_id,date) WHERE "events"."kind" = 'meetup'`);
      await db.prepare(`INSERT OR IGNORE INTO d1_migrations (name) VALUES (?1)`).bind(target.name).run();
    }
  });
});

// couples.anniversary_date（NOT NULL）を dating_date（NULL 許容）へ改名する（023）。couples は
// 複数の子テーブルから参照される親なので、行を入れた状態で当てる（conventions.md 6節）
describe("0012マイグレーション: 既存行のanniversary_dateがdating_dateへ引き継がれる", () => {
  it("anniversary_dateに値が入った既存行が、dating_dateへそのまま移る", async () => {
    const target = TEST_MIGRATIONS.find((m) => m.name === "0012_couple_dating_date_optional.sql");
    if (!target) throw new Error("0012のマイグレーションがTEST_MIGRATIONSに見つかりません");

    const coupleId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    // 0012 適用後の couples を退避し、0011 時点（anniversary_date NOT NULL・dating_date 無し）を再現する
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
      // 後片付け: 作った couples（TRIGGER ごと）を消し、退避した本来の couples を戻す。TRIGGER 名は
      // DB 全体で一意なので退避前に落としている。同じ名前で作り直す（定義が変わったらここも直す）
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

// events_repeat_yearly_check を足す（014）。既存の（制約どおりの）行が表の作り直しを生き延びる
// ことを確かめる。0011・0012 と同じ形
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

    // 0013 適用後の events を退避し、0012 時点（events_repeat_yearly_check 無し）を再現する
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

      // 制約も生きている（repeat_yearly=1 の meetup は拒まれる）
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
      // 後片付け: 作った events（索引ごと）を消し、退避した本来の events を戻して索引を作り直す
      await db.exec(`DROP TABLE IF EXISTS events`);
      await db.exec(`ALTER TABLE events_after_0013 RENAME TO events`);
      await db.exec(`CREATE INDEX events_couple_date_idx ON events (couple_id,date)`);
      await db.exec(`CREATE UNIQUE INDEX events_meetup_unique ON events (couple_id,date) WHERE "events"."kind" = 'meetup'`);
      await db.prepare(`INSERT OR IGNORE INTO d1_migrations (name) VALUES (?1)`).bind(target.name).run();
    }
  });
});

// invite_failures のキーを user_id から account_hash へ替える（024。packages/db/src/schema/couple.ts
// の inviteFailures 参照）。0014 で user_id を列ごと落とし、0015 で NOT NULL の account_hash を足す。
// SQLite は既存行があると NOT NULL の列を ADD できないので、先に DELETE で空にする。「既存行が
// 失われる」ことも 0015 の仕様なので、それが実際に起きることを確かめる
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

    // 0013 時点の invite_failures を退避し、user_id 方式を再現する
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
      // 後片付け: 作った invite_failures（索引ごと）を消し、退避した本来の表を戻して索引を作り直す
      await db.exec(`DROP TABLE IF EXISTS invite_failures`);
      await db.exec(`ALTER TABLE invite_failures_after_0015 RENAME TO invite_failures`);
      await db.exec(`CREATE INDEX invite_failures_account_created_idx ON invite_failures (account_hash,created_at)`);
      await db.exec(`CREATE INDEX invite_failures_ip_created_idx ON invite_failures (ip_address,created_at)`);
      await db.prepare(`INSERT OR IGNORE INTO d1_migrations (name) VALUES (?1)`).bind(target14.name).run();
      await db.prepare(`INSERT OR IGNORE INTO d1_migrations (name) VALUES (?1)`).bind(target15.name).run();
    }
  });
});

// wishes は FK で参照される親ではなく、0017 は ADD COLUMN 1 本なので、表を作り直す形の退避・
// 復元は要らない（028 5節）。note 列だけを一時的に落として 0016 時点を再現する
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

    // 0017 適用後の note 列を一時的に落とし、0016 時点を再現する
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

// posts.image_key は posts_image_key_unique（UNIQUE 索引）に使われている。SQLite は索引に使われて
// いる列を DROP COLUMN できないので、0019 は DROP INDEX → DROP COLUMN の順。順序を飛ばすと実際に
// 落ちることを確かめる（031 4節）
describe("0019マイグレーション: DROP INDEXを飛ばすとDROP COLUMNが落ちる（手順の根拠）", () => {
  it("posts_image_key_unique が残ったままだと image_key のDROP COLUMNが失敗し、DROP INDEX後は成功する", async () => {
    // 0019 適用後の posts は image_key を持たないので、一時的に足し戻して索引ありの状態を再現する
    await db.exec(`ALTER TABLE posts ADD COLUMN image_key text`);
    await db.exec(`CREATE UNIQUE INDEX posts_image_key_unique ON posts (image_key)`);

    try {
      // 索引が残ったままの DROP COLUMN は失敗する（手順の根拠）
      await expect(db.exec(`ALTER TABLE posts DROP COLUMN image_key`)).rejects.toThrow();

      // DROP INDEXしてからなら成功する
      await db.exec(`DROP INDEX posts_image_key_unique`);
      await expect(db.exec(`ALTER TABLE posts DROP COLUMN image_key`)).resolves.not.toThrow();
    } finally {
      // 後片付け: 失敗せずに終わった場合に備え、両方とも無い状態に揃える
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

// 既存の 1 枚（posts.image_key）が post_images の position=0 へ移ることを、行を入れた状態で当てて
// 確かめる（031。conventions.md 6節）。posts は表を作り直さず、列を足し戻すだけで 0018 時点を再現できる
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

    // 0019 適用後は post_images が実表で、posts は image_key 等を持たない。0018 時点（image_key・width・
    // height 列 + UNIQUE 索引、post_images 無し）を一時的に再現する
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

    // 論理削除済みで image_key が残っている投稿はありうる。post_images へ移すと「論理削除済みの
    // 投稿は post_images を持たない」（post.delete が物理削除する）と矛盾するので、移さない
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

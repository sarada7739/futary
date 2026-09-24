import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/index";

const db = (env as unknown as Bindings).DB;

// architecture.md 4節「実体とファイルのずれを、1つのテストで固定する」。
// DB に実在するものと drizzle のスキーマファイルから読めるものがずれる経路を、振る舞いのテストとは
// 別に固定する:
// - events_meetup_unique（部分 UNIQUE 索引）は表を作り直せば消え、誰も宣言していない状態になりうる
// - couples_married_date_required_*（TRIGGER）は drizzle のスキーマに現れず、スナップショットでは
//   CHECK と記録されるので drizzle-kit generate も差分を出さない
// - 表を作り直すマイグレーションで CHECK が落ちても、名前だけの走査では気づけない（CHECK は
//   CREATE TABLE 文の中にしか現れない。architecture.md 4節「CHECKには必ず名前を付ける」）
//
// 振る舞いのテストは制約が効くことを証明するが、存在することは証明しない。events_meetup_unique から
// WHERE 句が落ちても UNIQUE (couple_id, date) として残り、振る舞いのテストは通ったまま「記念日と
// 予定を同じ日に 1 件ずつしか置けない」別の壊れ方をする。なので sql 列まで突き合わせる
interface SchemaObjectRow {
  type: "index" | "trigger";
  name: string;
  sql: string;
}

async function listIndexesAndTriggers(): Promise<SchemaObjectRow[]> {
  const { results } = await db
    .prepare(
      `SELECT type AS type, name AS name, sql AS sql
         FROM sqlite_master
        WHERE type IN ('index','trigger') AND name NOT LIKE 'sqlite_%'
        ORDER BY type, name`,
    )
    .all<SchemaObjectRow>();
  return results;
}

// CREATE TABLE の全文は比べない（列を 1 つ足すだけで落ち、原因の分からない壊れ方になる）。
// 名前の付いた CHECK だけを CONSTRAINT "<name>" CHECK(...) の形で抜き出す
function extractNamedChecks(createTableSql: string): string[] {
  const pattern = /CONSTRAINT "([^"]+)" CHECK/g;
  return [...createTableSql.matchAll(pattern)]
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

async function listTableChecks(tableName: string): Promise<string[]> {
  const row = await db
    .prepare(`SELECT sql AS sql FROM sqlite_master WHERE type = 'table' AND name = ?1`)
    .bind(tableName)
    .first<{ sql: string }>();
  return extractNamedChecks(row?.sql ?? "");
}

describe("実際のマイグレーションが生成したindex/triggerの一覧（DBの実体を固定する）", () => {
  it("一覧が期待どおりである。増減があれば、それがそのままdrizzleスキーマへ反映すべき変更である", async () => {
    const objects = await listIndexesAndTriggers();

    expect(objects.map((o) => `${o.type}:${o.name}`)).toEqual([
      // 運営の操作の記録（直近 N 件を created_at 降順で。057）
      "index:admin_actions_created_idx",
      "index:album_photos_album_taken_idx",
      "index:album_photos_key_unique",
      "index:albums_couple_created_idx",
      "index:couple_members_couple_id_slot_unique",
      "index:couple_members_user_id_unique",
      "index:events_couple_date_idx",
      "index:events_meetup_unique",
      "index:invite_failures_account_created_idx",
      "index:invite_failures_ip_created_idx",
      "index:post_images_key_unique",
      "index:posts_couple_created_idx",
      "index:session_token_unique",
      "index:user_email_unique",
      "index:wants_couple_owner_created_idx",
      "index:wants_image_key_unique",
      "index:wishes_couple_created_idx",
      "trigger:couples_married_after_anniversary_insert",
      "trigger:couples_married_after_anniversary_update",
      "trigger:couples_married_date_required_insert",
      "trigger:couples_married_date_required_update",
    ]);
  });

  // couple_plans は索引・TRIGGER・名前付き CHECK を持たない（PK の自動索引は sqlite_% で除かれる）ので、
  // 上の一覧では拾えない。列を CREATE TABLE 文から確かめる（列が消えても型が変わっても赤。045 T9）
  it("couple_plans の表が実体にあり、列が定義どおり（couple_id PK・plan・source DEFAULT 'manual'・expires_at・updated_at）", async () => {
    const row = await db
      .prepare(`SELECT sql AS sql FROM sqlite_master WHERE type = 'table' AND name = 'couple_plans'`)
      .first<{ sql: string }>();
    expect(row, "couple_plans が実体に無い（0023_couple_plans が当たっていない）").not.toBeNull();
    const sql = row?.sql ?? "";
    expect(sql).toContain("`couple_id` text PRIMARY KEY NOT NULL");
    expect(sql).toContain("`plan` text NOT NULL");
    expect(sql).toContain("`source` text DEFAULT 'manual' NOT NULL");
    expect(sql).toContain("`expires_at` integer");
    expect(sql).toContain("`updated_at` integer NOT NULL");
    expect(sql).toContain("FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`)");
    // CHECK は持たない（027・040・041 と同じ。判定は lib/plan.ts の 1 箇所）
    expect(extractNamedChecks(sql)).toEqual([]);
  });

  // 0024_couple_plans_stripe（ADD COLUMN × 2）が当たっている。sqlite_master の sql は CREATE 文に
  // ADD COLUMN が追記された形になる（048）
  it("couple_plans に stripe_customer_id・stripe_subscription_id（text）・stripe_cancel_at（integer）がある。NULL 可・UNIQUE 無し", async () => {
    const columns = await db.prepare("PRAGMA table_info(couple_plans)").all<{ name: string; type: string; notnull: number }>();
    const byName = new Map(columns.results.map((c) => [c.name, c]));
    expect(byName.get("stripe_customer_id"), "0024_couple_plans_stripe が当たっていない").toMatchObject({ type: "TEXT", notnull: 0 });
    expect(byName.get("stripe_subscription_id")).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(byName.get("stripe_cancel_at")).toMatchObject({ type: "INTEGER", notnull: 0 });
    const indexes = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'couple_plans' AND name NOT LIKE 'sqlite_%'")
      .all<{ name: string }>();
    expect(indexes.results).toEqual([]);
  });

  // 0025_admin_actions。FK を張らない（退会しても残す。couple_id は消えたペアの id のまま）。
  // created_at の索引 1 つ（057 T8）
  it("admin_actions の表が実体にあり、列が定義どおり。FK 無し。created_at の索引がある", async () => {
    const columns = await db.prepare("PRAGMA table_info(admin_actions)").all<{ name: string; type: string; notnull: number; pk: number }>();
    expect(columns.results.map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual([
      ["id", "TEXT", 1, 1],
      ["admin_user_id", "TEXT", 1, 0],
      ["action", "TEXT", 1, 0],
      ["couple_id", "TEXT", 1, 0],
      ["detail", "TEXT", 1, 0],
      ["created_at", "INTEGER", 1, 0],
    ]);
    const fks = await db.prepare("PRAGMA foreign_key_list(admin_actions)").all();
    expect(fks.results).toEqual([]);
    const objects = await listIndexesAndTriggers();
    const index = objects.find((o) => o.name === "admin_actions_created_idx");
    expect(index?.sql).toContain("(`created_at`)");
  });

  // events_couple_date_idx はこの一覧テストだけが守る。列順が (date, couple_id) に変わっても名前は
  // 同じで、event.list 等の振る舞いは（性能が落ちるだけで）通り続ける
  it("events_couple_date_idx の列順が (couple_id, date) のままである", async () => {
    const objects = await listIndexesAndTriggers();
    const index = objects.find((o) => o.name === "events_couple_date_idx");

    expect(index?.sql).toContain("(`couple_id`,`date`)");
  });

  // 部分 UNIQUE 索引から WHERE 句が落ちると、同じ名前のまま UNIQUE (couple_id, date) になり、記念日と
  // 予定を同じ日に 1 件ずつしか置けなくなる（会った日の一意化テストは通ったまま。018）
  it("events_meetup_unique は kind='meetup' の部分インデックスのままである", async () => {
    const objects = await listIndexesAndTriggers();
    const index = objects.find((o) => o.name === "events_meetup_unique");

    expect(index?.sql).toContain("UNIQUE INDEX");
    expect(index?.sql).toContain("(`couple_id`,`date`)");
    expect(index?.sql).toContain("WHERE \"events\".\"kind\" = 'meetup'");
  });

  // TRIGGER が消える（表の作り直しで飛ぶ等）と、couple.update 以外の書き込み口で primary_date='married'
  // かつ married_date=NULL の行を作れる。WHEN 句の条件そのものも見る（019）
  it("couples_married_date_required の2本のTRIGGERが、INSERT/UPDATE両方に存在する", async () => {
    const objects = await listIndexesAndTriggers();
    const insertTrigger = objects.find((o) => o.name === "couples_married_date_required_insert");
    const updateTrigger = objects.find((o) => o.name === "couples_married_date_required_update");

    expect(insertTrigger?.sql).toContain("BEFORE INSERT ON `couples`");
    expect(insertTrigger?.sql).toContain("WHEN NEW.primary_date = 'married' AND NEW.married_date IS NULL");
    expect(updateTrigger?.sql).toContain("BEFORE UPDATE ON `couples`");
    expect(updateTrigger?.sql).toContain("WHEN NEW.primary_date = 'married' AND NEW.married_date IS NULL");
  });

  // 表の作り直しで CHECK が 1 本でも落ちると、名前は変わらず制約だけが消える（022）
  it("events のCHECK制約（名前の付いたもの）が全部そろっている", async () => {
    const checks = await listTableChecks("events");

    expect(checks).toEqual(
      [
        "events_end_time_after_start_check",
        "events_end_time_requires_start_check",
        "events_is_shared_check",
        "events_kind_check",
        "events_repeat_yearly_check",
        "events_start_time_check",
      ].sort(),
    );
  });

  // married_date が dating_date より前にならない制約も TRIGGER（019）。dating_date を参照するのは
  // この 2 本だけ（couples_married_date_required_* は参照しない。023）
  it("couples_married_after_anniversary の2本のTRIGGERが、INSERT/UPDATE両方に存在する", async () => {
    const objects = await listIndexesAndTriggers();
    const insertTrigger = objects.find((o) => o.name === "couples_married_after_anniversary_insert");
    const updateTrigger = objects.find((o) => o.name === "couples_married_after_anniversary_update");

    expect(insertTrigger?.sql).toContain("BEFORE INSERT ON `couples`");
    expect(insertTrigger?.sql).toContain(
      "WHEN NEW.married_date IS NOT NULL AND NEW.dating_date IS NOT NULL AND NEW.married_date < NEW.dating_date",
    );
    expect(updateTrigger?.sql).toContain("BEFORE UPDATE ON `couples`");
    expect(updateTrigger?.sql).toContain(
      "WHEN NEW.married_date IS NOT NULL AND NEW.dating_date IS NOT NULL AND NEW.married_date < NEW.dating_date",
    );
  });

  // level の範囲（1〜5）は Zod で弾く（conventions.md 5節）うえで、DB にも名前付き CHECK を置く
  // 二重の防御（029）
  it("moods のCHECK制約（名前の付いたもの）が全部そろっている", async () => {
    const checks = await listTableChecks("moods");

    expect(checks).toEqual(["moods_level_range_check"]);
  });

  // 枚数の上限（4 枚）は position(0..3) の CHECK と主キーで DB にも表す。Zod の max(4) だけに
  // 頼らない（031）
  it("post_images のCHECK制約（名前の付いたもの）が全部そろっている", async () => {
    const checks = await listTableChecks("post_images");

    expect(checks).toEqual(["post_images_position_range_check"]);
  });

  it("post_images_key_unique は key 列のUNIQUEインデックスのままである", async () => {
    const objects = await listIndexesAndTriggers();
    const index = objects.find((o) => o.name === "post_images_key_unique");

    expect(index?.sql).toContain("UNIQUE INDEX");
    expect(index?.sql).toContain("(`key`)");
  });
});

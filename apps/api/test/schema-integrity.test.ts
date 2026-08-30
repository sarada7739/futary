import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/index";

const db = (env as unknown as Bindings).DB;

// architecture.md 4節「実体とファイルのずれを、1つのテストで固定する」
// （018・019・Rの提案）。
//
// これまでに見つかった「DBに実在するものと、drizzleのスキーマファイルから
// 読めるものがずれる」経路を、振る舞いのテストとは別に固定する:
// - 018: events_meetup_unique（部分UNIQUEインデックス）は表を作り直せば消える。
//   誰も宣言していない状態になりうる
// - 019: couples_married_date_required_*（TRIGGER）はdrizzleのスキーマに
//   現れない
// - 019: 上記のTRIGGERはdrizzleのスナップショットではCHECKと記録されるため、
//   drizzle-kit generateは差分を検出しない
// - 022: 表を作り直すマイグレーションでCHECK制約が落ちても、名前だけ見る
//   走査では気づけない（CHECKはsqlite_masterではtype='table'のCREATE TABLE文
//   の中にしか現れない。architecture.md 4節「CHECKには必ず名前を付ける」）
//
// 振る舞いのテスト（例: event.test.tsの「同じ日に2件目のmeetupを作ると
// 1件のまま」）は制約が効くことを証明するが、制約が存在することは証明しない。
// events_meetup_unique からWHERE句が落ちてもUNIQUE (couple_id, date)として
// 生き残り、振る舞いのテストは通ったまま「記念日と予定を同じ日に1件ずつしか
// 置けない」という別の壊れ方をする。sql列まで突き合わせる（名前だけでは
// 足りない。Rの指摘）
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

// CREATE TABLE の全文は比較しない。列を1つ足すだけで落ち、「CHECKが消えた」
// ではなく「本文が違う」という原因の分からない壊れ方になる（Aの指摘）。
// 名前の付いたCHECK制約だけを CONSTRAINT "<name>" CHECK(...) の形で抜き出す
// （sqlite_masterのsqlから拾えるのは名前の付いたCHECKだけ。architecture.md
// 4節「CHECKには必ず名前を付ける」）
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
      "index:couple_members_couple_id_slot_unique",
      "index:couple_members_user_id_unique",
      "index:events_couple_date_idx",
      "index:events_meetup_unique",
      "index:invite_failures_ip_created_idx",
      "index:invite_failures_user_created_idx",
      "index:posts_couple_created_idx",
      "index:posts_image_key_unique",
      "index:session_token_unique",
      "index:user_email_unique",
      "trigger:couples_married_after_anniversary_insert",
      "trigger:couples_married_after_anniversary_update",
      "trigger:couples_married_date_required_insert",
      "trigger:couples_married_date_required_update",
    ]);
  });

  // events_couple_date_idxはこの一覧テストが固有に守る唯一の対象（Rレビュー指摘）。
  // 振る舞いのテストからは捕まえられない: 列順が(date, couple_id)に変わっても
  // 名前は変わらず、event.list等の振る舞いは（性能が落ちるだけで）通り続ける
  it("events_couple_date_idx の列順が (couple_id, date) のままである", async () => {
    const objects = await listIndexesAndTriggers();
    const index = objects.find((o) => o.name === "events_couple_date_idx");

    expect(index?.sql).toContain("(`couple_id`,`date`)");
  });

  // 018: 部分UNIQUEインデックスからWHERE句が落ちると、events_meetup_uniqueという
  // 名前のまま単なるUNIQUE (couple_id, date)になり、記念日と予定を同じ日に
  // 1件ずつしか置けなくなる（会った日の一意化テストは通ったまま壊れる）
  it("events_meetup_unique は kind='meetup' の部分インデックスのままである", async () => {
    const objects = await listIndexesAndTriggers();
    const index = objects.find((o) => o.name === "events_meetup_unique");

    expect(index?.sql).toContain("UNIQUE INDEX");
    expect(index?.sql).toContain("(`couple_id`,`date`)");
    expect(index?.sql).toContain("WHERE \"events\".\"kind\" = 'meetup'");
  });

  // 019: TRIGGERが消える（表の作り直しで飛ぶ等）と、couple.update以外の
  // 書き込み口（将来のシード等）でprimary_date='married'かつmarried_date=NULLの
  // 行を直接作れてしまう。WHEN句の条件そのものも確認する
  it("couples_married_date_required の2本のTRIGGERが、INSERT/UPDATE両方に存在する", async () => {
    const objects = await listIndexesAndTriggers();
    const insertTrigger = objects.find((o) => o.name === "couples_married_date_required_insert");
    const updateTrigger = objects.find((o) => o.name === "couples_married_date_required_update");

    expect(insertTrigger?.sql).toContain("BEFORE INSERT ON `couples`");
    expect(insertTrigger?.sql).toContain("WHEN NEW.primary_date = 'married' AND NEW.married_date IS NULL");
    expect(updateTrigger?.sql).toContain("BEFORE UPDATE ON `couples`");
    expect(updateTrigger?.sql).toContain("WHEN NEW.primary_date = 'married' AND NEW.married_date IS NULL");
  });

  // 022: 表の作り直しでCHECKが1本でも落ちると、名前は変わらず制約だけが
  // 消える（events_meetup_uniqueのWHERE句が落ちるのと同じ壊れ方）。
  // events_kind_checkにはこれまでDBレベルのテストが1つも無かった（Aの指摘）
  it("events のCHECK制約（名前の付いたもの）が全部そろっている", async () => {
    const checks = await listTableChecks("events");

    expect(checks).toEqual(
      [
        "events_end_time_after_start_check",
        "events_end_time_requires_start_check",
        "events_is_shared_check",
        "events_kind_check",
        "events_start_time_check",
      ].sort(),
    );
  });

  // 019: married_dateがanniversary_dateより前にならない制約も同じ理由でTRIGGER
  it("couples_married_after_anniversary の2本のTRIGGERが、INSERT/UPDATE両方に存在する", async () => {
    const objects = await listIndexesAndTriggers();
    const insertTrigger = objects.find((o) => o.name === "couples_married_after_anniversary_insert");
    const updateTrigger = objects.find((o) => o.name === "couples_married_after_anniversary_update");

    expect(insertTrigger?.sql).toContain("BEFORE INSERT ON `couples`");
    expect(insertTrigger?.sql).toContain(
      "WHEN NEW.married_date IS NOT NULL AND NEW.married_date < NEW.anniversary_date",
    );
    expect(updateTrigger?.sql).toContain("BEFORE UPDATE ON `couples`");
    expect(updateTrigger?.sql).toContain(
      "WHEN NEW.married_date IS NOT NULL AND NEW.married_date < NEW.anniversary_date",
    );
  });
});

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/index";

const db = (env as unknown as Bindings).DB;

// architecture.md 4節「実体とファイルのずれを、1つのテストで固定する」
// （018・019・Rの提案）。
//
// これまでに見つかった3つの「DBに実在するものと、drizzleのスキーマファイルから
// 読めるものがずれる」経路を、振る舞いのテストとは別に固定する:
// - 018: events_meetup_unique（部分UNIQUEインデックス）は表を作り直せば消える。
//   誰も宣言していない状態になりうる
// - 019: couples_married_date_required_*（TRIGGER）はdrizzleのスキーマに
//   現れない
// - 019: 上記のTRIGGERはdrizzleのスナップショットではCHECKと記録されるため、
//   drizzle-kit generateは差分を検出しない
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
      "trigger:couples_married_date_required_insert",
      "trigger:couples_married_date_required_update",
    ]);
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
});

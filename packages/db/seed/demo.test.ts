import { describe, expect, it } from "vitest";
import { buildDemoSeed, buildDemoSeedSql } from "./demo";

// 014タスク定義の完了条件を、実際にD1/R2へ投入する前に固定する。
// 「見つかった場合に対応する」ではなく、この生成ロジックが違反を作らないことを
// テストで保証する（conventions.md「必ずテストを書く対象」）

describe("buildDemoSeed", () => {
  it("同じ nowMs なら常に同じ結果になる（乱数を使っていない）", () => {
    const nowMs = Date.UTC(2026, 7, 31);
    const a = buildDemoSeedSql(nowMs);
    const b = buildDemoSeedSql(nowMs);
    expect(a).toBe(b);
  });

  it("meetup の日付が重複しない（events_meetup_unique に違反しない）", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    const meetupDates = seed.events.filter((e) => e.kind === "meetup").map((e) => e.date);
    expect(new Set(meetupDates).size).toBe(meetupDates.length);
  });

  it("meetup が80〜100件、planが5〜8件、anniversaryが3〜5件である", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    const countOf = (kind: string) => seed.events.filter((e) => e.kind === kind).length;
    expect(countOf("meetup")).toBeGreaterThanOrEqual(80);
    expect(countOf("meetup")).toBeLessThanOrEqual(100);
    expect(countOf("plan")).toBeGreaterThanOrEqual(5);
    expect(countOf("plan")).toBeLessThanOrEqual(8);
    expect(countOf("anniversary")).toBeGreaterThanOrEqual(3);
    expect(countOf("anniversary")).toBeLessThanOrEqual(5);
  });

  it("投稿が30〜50件、うち画像付きは4件である", () => {
    // タスク定義の目安は5〜8件だが、素材5枚のうち1枚（旧meetup-3.jpg）に
    // 実在しそうな店名の看板が写り込んでいたため使わないことにした
    // （security-auditor指摘。docs/sample/README.mdがeHaCqEMx.jpgを
    // 除外したのと同じ理由）。残り4枚を使う
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    expect(seed.posts.length).toBeGreaterThanOrEqual(30);
    expect(seed.posts.length).toBeLessThanOrEqual(50);
    const withImage = seed.posts.filter((p) => p.imageKey !== null);
    expect(withImage.length).toBe(4);
  });

  it("画像付きの投稿は、同じ画像を使い回さない", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    const imageKeys = seed.posts.map((p) => p.imageKey).filter((k): k is string => k !== null);
    expect(new Set(imageKeys).size).toBe(imageKeys.length);
  });

  it("repeat_yearly=true の行は kind='anniversary' だけである（events_repeat_yearly_check）", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    for (const e of seed.events) {
      if (e.repeatYearly) expect(e.kind).toBe("anniversary");
    }
  });

  it("anniversary は start_time を持たない（events_start_time_check）", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    for (const e of seed.events) {
      if (e.kind === "anniversary") expect(e.startTime).toBeNull();
    }
  });

  it("end_time は start_time が無いと立てられず、start_timeより後である", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    for (const e of seed.events) {
      if (e.endTime !== null) {
        expect(e.startTime).not.toBeNull();
        expect(e.endTime > (e.startTime ?? "")).toBe(true);
      }
    }
  });

  it("plan に未来の日付が含まれる", () => {
    const nowMs = Date.UTC(2026, 7, 31);
    const seed = buildDemoSeed(nowMs);
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const plans = seed.events.filter((e) => e.kind === "plan");
    expect(plans.some((p) => p.date > today)).toBe(true);
  });

  it("created_by が両方のユーザーに振り分けられている（meetup）", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    const creators = new Set(seed.events.filter((e) => e.kind === "meetup").map((e) => e.createdBy));
    expect(creators.size).toBe(2);
  });

  it("meetup に時間ありと時間なしが混ざっている", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    const meetups = seed.events.filter((e) => e.kind === "meetup");
    expect(meetups.some((e) => e.startTime !== null)).toBe(true);
    expect(meetups.some((e) => e.startTime === null)).toBe(true);
  });

  it("デモペアには dating_date が必ず入る（unset にしない）", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    expect(seed.datingDate).not.toBeNull();
    expect(seed.datingDate.length).toBeGreaterThan(0);
  });

  it("1ヶ月前・半年前・1年前ぴったりの投稿が存在する（memory.getの探索順）", () => {
    const nowMs = Date.UTC(2026, 7, 31);
    const seed = buildDemoSeed(nowMs);
    const dates = seed.posts.map((p) => p.date);
    expect(dates).toContain("2026-07-31");
    expect(dates).toContain("2026-02-28");
    expect(dates).toContain("2025-08-31");
  });

  // 027: 「リスト」パネルが押せるようになるため、デモに達成済み・未達成の
  // 両方を入れる（並び順が見えるように）
  it("wishesに達成済みと未達成の両方が入っている", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    expect(seed.wishes.some((w) => w.doneAt === null)).toBe(true);
    expect(seed.wishes.some((w) => w.doneAt !== null)).toBe(true);
  });

  it("wishesの作成者が両方のユーザーに振り分けられている", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    const creators = new Set(seed.wishes.map((w) => w.createdBy));
    expect(creators.size).toBe(2);
  });

  it("wishesのcreatedAtに重複が無い（並び順を実際に確認できる）", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    const createdAts = seed.wishes.map((w) => w.createdAt);
    expect(new Set(createdAts).size).toBe(createdAts.length);
  });

  // 028: メモ有り・無しの両方を入れる（設定者2人分と同じく、名前が出ることが
  // 見えるようにするのと同じ理由でメモがあることも見えるようにする）
  it("wishesにメモ有りと無しの両方が入っている", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    expect(seed.wishes.some((w) => w.note.length > 0)).toBe(true);
    expect(seed.wishes.some((w) => w.note.length === 0)).toBe(true);
  });

  it("反応は投稿者本人ではなく相手から付く", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    const postById = new Map(seed.posts.map((p) => [p.id, p]));
    for (const r of seed.reactions) {
      const post = postById.get(r.postId);
      expect(post).toBeDefined();
      expect(r.userId).not.toBe(post?.authorId);
    }
  });
});

describe("buildDemoSeedSql", () => {
  it("既存行を消してから作り直すDELETE文が、INSERT文より前に並ぶ", () => {
    const sql = buildDemoSeedSql(Date.UTC(2026, 7, 31));
    const firstInsertIndex = sql.indexOf("INSERT INTO");
    const lastDeleteIndex = sql.lastIndexOf("DELETE FROM");
    expect(lastDeleteIndex).toBeGreaterThan(-1);
    expect(firstInsertIndex).toBeGreaterThan(lastDeleteIndex);
  });

  it("外部キーの順で消す: reactions -> posts -> events -> wishes -> invites -> couple_members -> couples -> user", () => {
    const sql = buildDemoSeedSql(Date.UTC(2026, 7, 31));
    const order = ["reactions", "posts", "events", "wishes", "invites", "couple_members", "couples", "user"];
    const positions = order.map((table) => sql.indexOf(`DELETE FROM ${table}`));
    for (const pos of positions) expect(pos).toBeGreaterThan(-1);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1] ?? -1);
    }
  });

  // security-auditor指摘: is_demoを落としてもテストが緑のままになる穴があった
  // （fail-closedなのでデモが表示されなくなるだけで漏洩はしないが、
  // 気づけない形は良くない）
  it("couplesのINSERT文でis_demoが1になっている", () => {
    const sql = buildDemoSeedSql(Date.UTC(2026, 7, 31));
    const match = sql.match(
      /INSERT INTO couples \(id, dating_date, married_date, primary_date, is_demo, created_at\) VALUES \(([^;]*)\);/,
    );
    expect(match).not.toBeNull();
    const values = match?.[1]?.split(", ") ?? [];
    // id, dating_date, married_date, primary_date, is_demo, created_at の6列
    expect(values).toHaveLength(6);
    expect(values[4]).toBe("1");
  });
});

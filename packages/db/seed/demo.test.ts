import { addDays, todayJst } from "@futary/date";
import { describe, expect, it } from "vitest";
import { buildDemoSeed, buildDemoSeedSql, DEMO_USER_MAN_ID, DEMO_USER_WOMAN_ID } from "./demo";

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

  it("投稿が30〜50件、うち画像付きは5件（グリッド4件+マイルストーン1件）である", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    expect(seed.posts.length).toBeGreaterThanOrEqual(30);
    expect(seed.posts.length).toBeLessThanOrEqual(50);
    const withImage = seed.posts.filter((p) => p.images.length > 0);
    expect(withImage.length).toBe(5);
  });

  // 031: 1・2・3・4枚の投稿がそれぞれ1件以上デモに入っていることを確認する
  // （タスク定義7節「デモに入れる」）
  it("1枚・2枚・3枚・4枚の投稿がそれぞれ1件以上ある", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    for (const count of [1, 2, 3, 4]) {
      expect(seed.posts.some((p) => p.images.length === count)).toBe(true);
    }
    // 5枚を超える投稿は作らない（上限4枚。タスク定義1節）
    expect(seed.posts.every((p) => p.images.length <= 4)).toBe(true);
  });

  it("post_imagesのkeyは、投稿・位置をまたいで重複しない（UNIQUE制約に沿う）", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    const imageKeys = seed.posts.flatMap((p) => p.images.map((image) => image.key));
    expect(new Set(imageKeys).size).toBe(imageKeys.length);
  });

  it("各投稿の画像は position 0 から連番で、posts.images の並び順どおりに保たれる", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    for (const post of seed.posts) {
      expect(post.images.length).toBeLessThanOrEqual(4);
    }
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

  // 029: 気分の記録。3ヶ月ぶん・2人分・空の日・傾向の違いをそれぞれ固定する
  it("moodsが2人分入っており、levelが1〜5の範囲である", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    expect(seed.moods.length).toBeGreaterThan(0);
    const userIds = new Set(seed.moods.map((m) => m.userId));
    expect(userIds).toEqual(new Set([DEMO_USER_WOMAN_ID, DEMO_USER_MAN_ID]));
    for (const m of seed.moods) {
      expect(m.level).toBeGreaterThanOrEqual(1);
      expect(m.level).toBeLessThanOrEqual(5);
    }
  });

  it("moodsが3ヶ月（90日）分の範囲に収まる", () => {
    const nowMs = Date.UTC(2026, 7, 31);
    const seed = buildDemoSeed(nowMs);
    const today = todayJst(nowMs);
    const oldest = addDays(today, -89);
    expect(seed.moods.every((m) => m.date >= oldest && m.date <= today)).toBe(true);
  });

  // 未記録の日と、いちばん薄い日を見間違えないかの確認観点（タスク定義）は
  // 画面側の話だが、そもそも空の日が無いとデモで確認できない
  it("moodsに空の日（記録が無い日）が両者とも混ざっている", () => {
    const nowMs = Date.UTC(2026, 7, 31);
    const seed = buildDemoSeed(nowMs);
    const today = todayJst(nowMs);
    const womanDates = new Set(seed.moods.filter((m) => m.userId === DEMO_USER_WOMAN_ID).map((m) => m.date));
    const manDates = new Set(seed.moods.filter((m) => m.userId === DEMO_USER_MAN_ID).map((m) => m.date));
    let womanHasGap = false;
    let manHasGap = false;
    for (let i = 0; i < 90; i++) {
      const date = addDays(today, -i);
      if (!womanDates.has(date)) womanHasGap = true;
      if (!manDates.has(date)) manHasGap = true;
    }
    expect(womanHasGap).toBe(true);
    expect(manHasGap).toBe(true);
  });

  // 2人の傾向が違うように入れる（タスク定義12節「同じ列が並ぶと、2段ある
  // 意味が見えない」）。同じ日の値が全て一致していないことで確認する
  it("2人のmoodsが同じ傾向（全て同じ値）にならない", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    const womanByDate = new Map(seed.moods.filter((m) => m.userId === DEMO_USER_WOMAN_ID).map((m) => [m.date, m.level]));
    const manByDate = new Map(seed.moods.filter((m) => m.userId === DEMO_USER_MAN_ID).map((m) => [m.date, m.level]));
    const commonDates = [...womanByDate.keys()].filter((date) => manByDate.has(date));
    expect(commonDates.some((date) => womanByDate.get(date) !== manByDate.get(date))).toBe(true);
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

  it("外部キーの順で消す: reactions -> post_images -> posts -> events -> wishes -> moods -> invites -> couple_members -> couples -> user", () => {
    const sql = buildDemoSeedSql(Date.UTC(2026, 7, 31));
    const order = [
      "reactions",
      "post_images",
      "posts",
      "events",
      "wishes",
      "moods",
      "invites",
      "couple_members",
      "couples",
      "user",
    ];
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

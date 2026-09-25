import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, todayJst } from "@futary/date";
import { describe, expect, it } from "vitest";
import { buildDemoSeed, buildDemoSeedSql, DEMO_ASSET_FILES, DEMO_USER_MAN_ID, DEMO_USER_WOMAN_ID } from "./demo";

// JPEG の SOF（0xFFC0〜0xFFCF。DHT 0xC4・JPG 0xC8・DAC 0xCC を除く）から幅と高さを読む
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    }
    i += 2 + length;
  }
  return null;
}

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
  // ゆい 3 件・れん 2 件。画像は 2 件。手に入れたものが 1 件（040・064 T1）
  it("wantsはゆい3件・れん2件。画像は2件R2に置く。手に入れたものが1件ある", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    expect(seed.wants.filter((w) => w.ownerId === DEMO_USER_WOMAN_ID)).toHaveLength(3);
    expect(seed.wants.filter((w) => w.ownerId === DEMO_USER_MAN_ID)).toHaveLength(2);
    const withImage = seed.wants.filter((w) => w.imageKey !== null);
    expect(withImage).toHaveLength(2);
    for (const want of withImage) {
      expect(want.imageKey).toMatch(/^couples\/demo-couple\/wants\/.+\.jpg$/);
      expect(seed.images.some((image) => image.key === want.imageKey)).toBe(true);
    }
    expect(seed.wants.filter((w) => w.obtainedAt !== null)).toHaveLength(1);
    expect(seed.wants.every((w) => w.url?.startsWith("https://"))).toBe(true);
  });

  // 実在の店を指すのは Amazon の 1 件だけで、追跡の引数は付けない。他は example.com（064 T2）
  it("amazon.co.jp を指すのは1件だけでURLに ? が無い。他は example.com", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    const hosts = seed.wants.map((w) => new URL(w.url ?? "").hostname);
    const amazon = seed.wants.filter((w) => new URL(w.url ?? "").hostname === "www.amazon.co.jp");
    expect(amazon).toHaveLength(1);
    expect(amazon[0]?.url).toBe("https://www.amazon.co.jp/dp/B00F2G8ZLS");
    expect(amazon[0]?.url).not.toContain("?");
    expect(amazon[0]?.imageKey).not.toBeNull();
    expect(amazon[0]?.ownerId).toBe(DEMO_USER_WOMAN_ID);
    expect(hosts.filter((h) => h !== "www.amazon.co.jp").every((h) => h === "example.com" || h.endsWith(".example.com"))).toBe(true);
  });

  // 同梱の画像は 800×800・250KB 以下（064 T3）
  it("want-gunze.jpg は 800×800・250KB 以下の JPEG", () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", DEMO_ASSET_FILES.wantGunze);
    const bytes = new Uint8Array(readFileSync(file));
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect(jpegSize(bytes)).toEqual({ width: 800, height: 800 });
    expect(bytes.length).toBeLessThanOrEqual(250 * 1024);
  });

  // 041: アルバム 1 件（題名・期間つき）と写真 3 枚
  it("albumsは1件で題名・期間つき。写真は3枚が albums/ のキーで、post_images のキーとは別のオブジェクト", () => {
    const seed = buildDemoSeed();
    expect(seed.albums).toHaveLength(1);
    const album = seed.albums[0]!;
    expect(album.title.length).toBeGreaterThan(0);
    expect(album.startDate).not.toBeNull();
    expect(album.endDate).not.toBeNull();
    expect(album.endDate! >= album.startDate!).toBe(true);
    expect(seed.albumPhotos).toHaveLength(3);
    expect(seed.albumPhotos.every((p) => p.albumId === album.id)).toBe(true);
    expect(seed.albumPhotos.every((p) => /^couples\/demo-couple\/albums\/.+\.jpg$/.test(p.key))).toBe(true);
    expect(seed.albumPhotos.map((p) => p.id)).toContain(album.coverPhotoId);
    const postKeys = new Set(seed.posts.flatMap((p) => p.images.map((i) => i.key)));
    expect(seed.albumPhotos.some((p) => postKeys.has(p.key))).toBe(false);
    // R2 に置く一覧（images）に 3 枚とも含まれる
    const imageKeys = new Set(seed.images.map((i) => i.key));
    expect(seed.albumPhotos.every((p) => imageKeys.has(p.key))).toBe(true);
    // 古い順に並ぶことがデモで見えるよう taken_at が単調に増える
    const takenAts = seed.albumPhotos.map((p) => p.takenAt);
    expect([...takenAts].sort((a, b) => a - b)).toEqual(takenAts);
  });

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

  // 037: デモではまとめを生成しない（タスク定義10節）。シードに先月・先週
  // ぶんを1件ずつ、人が書いた文章として入れる（実際に生成したものではない）
  it("aiSummariesが月・週それぞれ1件ずつ入っており、provider/modelを持つ", () => {
    const seed = buildDemoSeed(Date.UTC(2026, 7, 31));
    expect(seed.aiSummaries).toHaveLength(2);

    const monthSummary = seed.aiSummaries.find((s) => s.periodKind === "month");
    expect(monthSummary?.periodKey).toMatch(/^\d{4}-\d{2}$/);
    expect(monthSummary?.provider).toBe("openai");
    expect(monthSummary?.model.length).toBeGreaterThan(0);
    expect(monthSummary?.body.length).toBeGreaterThan(0);

    const weekSummary = seed.aiSummaries.find((s) => s.periodKind === "week");
    expect(weekSummary?.periodKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(weekSummary?.provider).toBe("openai");
    expect(weekSummary?.model.length).toBeGreaterThan(0);
    expect(weekSummary?.body.length).toBeGreaterThan(0);
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

  it("外部キーの順で消す: reactions -> post_images -> posts -> events -> wishes -> moods -> ai_summaries -> couple_plans -> invites -> couple_members -> couples -> user", () => {
    const sql = buildDemoSeedSql(Date.UTC(2026, 7, 31));
    const order = [
      "reactions",
      "post_images",
      "posts",
      "events",
      "wishes",
      "moods",
      "ai_summaries",
      // 045: couple_plans.couple_id が couples を参照する。couples より先に消す
      "couple_plans",
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

  // 045: デモペアは paid の行を持つ（ゲストに「無料プランでは…」を出さない。タスク定義 0節 #9）
  it("couple_plans の INSERT 文が 1 件あり、plan は 'paid'・expires_at は NULL", () => {
    const sql = buildDemoSeedSql(Date.UTC(2026, 7, 31));
    const matches = sql.match(/INSERT INTO couple_plans \(couple_id, plan, source, expires_at, updated_at\) VALUES \(([^;]*)\);/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toContain("'paid', 'manual', NULL,");
    // couples の INSERT より後（FK）
    expect(sql.indexOf("INSERT INTO couple_plans")).toBeGreaterThan(sql.indexOf("INSERT INTO couples"));
  });

  // 037: buildInsertSqlにai_summariesのINSERT文が実際に含まれることを確認する
  // （DemoSeed.aiSummariesに値を積んだだけでSQL化を忘れる穴を防ぐ）
  it("ai_summariesのINSERT文が2件（月・週）含まれる", () => {
    const sql = buildDemoSeedSql(Date.UTC(2026, 7, 31));
    const matches = sql.match(/INSERT INTO ai_summaries/g) ?? [];
    expect(matches).toHaveLength(2);
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

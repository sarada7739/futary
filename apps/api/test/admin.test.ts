import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { beforeEach, describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";
import { generateImageId } from "../src/lib/ulid";
import { albumImageKeyFor, imageKeyFor } from "../src/lib/r2-signed-url";
import { isAdminEmail, parseAdminEmails } from "../src/lib/admin-emails";
import { computeStats, loadStats, resetStatsCache, statsWindows, STATS_TTL_MS } from "../src/procedures/admin";

// 運営の画面（057 4節 T1〜T6）。返すのは数と couple_plans の 1 行だけ。本文・名前・写真の URL・
// 記念日は返さない（T3 でキーを固定）

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

const r2Sign: RpcContext["r2Sign"] = {
  accountId: "test-account",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  bucketName: "test-bucket",
};

type TestUser = { id: string; name: string; email: string };
let userSeq = 0;
const nowSec = () => Math.floor(Date.now() / 1000);

async function createUser(createdAt: number = nowSec()): Promise<TestUser> {
  userSeq += 1;
  const id = `admin-user-${userSeq}-${crypto.randomUUID()}`;
  const name = `テストユーザー${userSeq}`;
  const email = `admin-user-${userSeq}-${crypto.randomUUID()}@example.com`;
  await db.batch([
    db
      .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)")
      .bind(id, name, email, createdAt),
    db
      .prepare(
        "INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at) VALUES (?1, 'google', ?2, 'google', ?3, ?4, ?4)",
      )
      .bind(crypto.randomUUID(), `google-sub-${id}`, id, createdAt),
  ]);
  return { id, name, email };
}

// 運営のメール（ADMIN_EMAILS 相当）。テストごとに作った運営を登録する。大文字・空白を混ぜた形で渡し、
// 比べるときに揃う（小文字化・trim）ことを見る
const adminEmails: string[] = [];
function registerAdmin(email: string): void {
  adminEmails.push(` ${email.toUpperCase()} `);
}

function contextFor(user: TestUser | null, options: { demoCoupleId?: string | null; adminEmails?: readonly string[] } = {}): RpcContext {
  return {
    db,
    bucket,
    r2Sign,
    aiEnv: { provider: "openai", openaiApiKey: "test-openai-key" },
    adminEmails: options.adminEmails ?? parseAdminEmails(adminEmails.join(",")),
    user: user ? { ...user, image: null } : null,
    ip: "203.0.113.1",
    demoCoupleId: options.demoCoupleId ?? null,
    sessionCreatedAt: user ? Date.now() : null,
    authSecret: "test-secret",
  };
}

async function createPair(): Promise<{ owner: TestUser; partner: TestUser; coupleId: string }> {
  const owner = await createUser();
  const partner = await createUser();
  const couple = await call(router.couple.create, {}, { context: contextFor(owner) });
  const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
  await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
  return { owner, partner, coupleId: couple.id };
}

// 運営 = メールが ADMIN_EMAILS に含まれる利用者
async function createAdmin(): Promise<TestUser> {
  const admin = await createUser();
  registerAdmin(admin.email);
  return admin;
}

async function setPlanRow(coupleId: string, plan: string, source: "manual" | "stripe", expiresAt: number | null, updatedAt = nowSec()) {
  await db
    .prepare(
      `INSERT INTO couple_plans (couple_id, plan, source, expires_at, updated_at, stripe_customer_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(couple_id) DO UPDATE SET plan = ?2, source = ?3, expires_at = ?4, updated_at = ?5, stripe_customer_id = ?6`,
    )
    .bind(coupleId, plan, source, expiresAt, updatedAt, source === "stripe" ? "cus_test" : null)
    .run();
}

// 投稿（本文と画像 n 枚）を直接置く
async function insertPost(coupleId: string, authorId: string, images: number, createdAt: number, body = "本文"): Promise<string> {
  const id = crypto.randomUUID();
  const statements = [
    db
      .prepare("INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(id, coupleId, authorId, body, createdAt),
  ];
  for (let i = 0; i < images; i++) {
    const imageId = generateImageId();
    statements.push(
      db
        .prepare("INSERT INTO post_images (post_id, position, key, width, height) VALUES (?1, ?2, ?3, 100, 100)")
        .bind(id, i, imageKeyFor(coupleId, imageId)),
    );
  }
  await db.batch(statements);
  return id;
}

async function insertAlbumWithPhotos(coupleId: string, createdBy: string, photos: number, createdAt: number): Promise<string> {
  const albumId = crypto.randomUUID();
  const statements = [
    db
      .prepare(
        `INSERT INTO albums (id, couple_id, title, note, created_by, created_at, updated_at) VALUES (?1, ?2, 'アルバム', '', ?3, ?4, ?4)`,
      )
      .bind(albumId, coupleId, createdBy, createdAt),
  ];
  for (let i = 0; i < photos; i++) {
    const id = generateImageId();
    statements.push(
      db
        .prepare(
          `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at) VALUES (?1, ?2, ?3, 1, 1, '', ?4, ?4)`,
        )
        .bind(id, albumId, albumImageKeyFor(coupleId, id), createdAt),
    );
  }
  await db.batch(statements);
  return albumId;
}

async function createDemoPair(): Promise<{ coupleId: string; user: TestUser }> {
  const user = await createUser();
  const coupleId = `demo-${crypto.randomUUID()}`;
  await db.batch([
    db
      .prepare("INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (?1, '2025-01-01', NULL, 'dating', 1, ?2)")
      .bind(coupleId, nowSec()),
    db.prepare("INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES (?1, ?2, 1, ?3)").bind(coupleId, user.id, nowSec()),
  ]);
  return { coupleId, user };
}

beforeEach(() => {
  resetStatsCache();
});

describe("057 T1: admin.* は ADMIN_EMAILS に含まれる認証済みだけ", () => {
  it("parseAdminEmails / isAdminEmail: カンマ区切り・小文字化・trim。空・未設定は運営無し", () => {
    expect(parseAdminEmails(" A@Example.com, b@example.com ,,")).toEqual(["a@example.com", "b@example.com"]);
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails("")).toEqual([]);
    expect(isAdminEmail("a@example.com", ["a@example.com"])).toBe(true);
    expect(isAdminEmail("  A@EXAMPLE.COM ", ["a@example.com"])).toBe(true);
    expect(isAdminEmail("c@example.com", ["a@example.com"])).toBe(false);
    expect(isAdminEmail("", [""])).toBe(false);
  });

  it("含まれないメールの認証済み・ゲスト → 4 つとも FORBIDDEN。含まれるメール（大文字・空白の違いあり）→ 通る。ADMIN_EMAILS 無し → 運営でも FORBIDDEN", async () => {
    const { owner, coupleId } = await createPair();
    const admin = await createAdmin();
    const demo = await createDemoPair();
    const calls = (ctx: RpcContext) => [
      call(router.admin.stats, {}, { context: ctx }),
      call(router.admin.lookup, { email: owner.email }, { context: ctx }),
      call(router.admin.setPlan, { coupleId, plan: "paid" }, { context: ctx }),
      call(router.admin.actions, {}, { context: ctx }),
    ];
    for (const p of calls(contextFor(owner))) await expect(p).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const p of calls(contextFor(null, { demoCoupleId: demo.coupleId }))) await expect(p).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const p of calls(contextFor(admin, { adminEmails: [] }))) await expect(p).rejects.toMatchObject({ code: "FORBIDDEN" });
    // 運営: user.email は小文字だが ADMIN_EMAILS 側は大文字・前後の空白で渡してある（registerAdmin）
    const ctx = contextFor(admin);
    expect((await call(router.admin.stats, {}, { context: ctx })).couples.total).toBeGreaterThanOrEqual(1);
    expect((await call(router.admin.lookup, { email: owner.email }, { context: ctx })).user?.email).toBe(owner.email);
    expect((await call(router.admin.actions, {}, { context: ctx })).items).toBeInstanceOf(Array);
    // メール側に大文字・空白があっても通る
    const upper = { ...admin, email: `  ${admin.email.toUpperCase()} ` };
    expect((await call(router.admin.stats, {}, { context: contextFor(upper) })).couples.total).toBeGreaterThanOrEqual(1);
  });
});

describe("057 T5: couple.get の isAdmin", () => {
  it("運営 true・他 false・ゲスト false", async () => {
    const { owner } = await createPair();
    const admin = await createAdmin();
    await call(router.couple.create, {}, { context: contextFor(admin) });
    const demo = await createDemoPair();
    expect((await call(router.couple.get, undefined, { context: contextFor(admin) })).isAdmin).toBe(true);
    expect((await call(router.couple.get, undefined, { context: contextFor(owner) })).isAdmin).toBe(false);
    expect((await call(router.couple.get, undefined, { context: contextFor(null, { demoCoupleId: demo.coupleId }) })).isAdmin).toBe(false);
  });
});

describe("057 T2: admin.stats（デモを除く。今日の増加と 7 日平均は created_at から。JST の境目を固定）", () => {
  // 2026-09-16 12:00 JST = 03:00Z。今日の始まりは 2026-09-15T15:00Z
  const NOW_MS = Date.UTC(2026, 8, 16, 3, 0, 0);
  const DAY = 24 * 60 * 60;

  it("statsWindows: 今日の始まりは JST 0:00、週の始まりはその 7 日前", () => {
    const { todayStart, weekStart } = statsWindows(NOW_MS);
    expect(todayStart).toBe(Date.UTC(2026, 8, 15, 15, 0, 0) / 1000);
    expect(weekStart).toBe(todayStart - 7 * DAY);
    // 0:00 JST ちょうどは今日
    expect(statsWindows(Date.UTC(2026, 8, 15, 15, 0, 0)).todayStart).toBe(Date.UTC(2026, 8, 15, 15, 0, 0) / 1000);
    // その 1 秒前は前日
    expect(statsWindows(Date.UTC(2026, 8, 15, 14, 59, 59)).todayStart).toBe(Date.UTC(2026, 8, 14, 15, 0, 0) / 1000);
  });

  it("computeStats: ペア・利用者・paid・投稿・画像の 5 つ。デモは数に入らない。today と avg7d が正しい", async () => {
    const { todayStart } = statsWindows(NOW_MS);
    const before = await computeStats(db, NOW_MS);

    // 今日 1 ペア（2 人）、8 日前に 1 ペア（2 人。週の外）、3 日前に 1 ペア（週の中）
    const todayPair = await createPair();
    await db.prepare("UPDATE couples SET created_at = ?1 WHERE id = ?2").bind(todayStart + 60, todayPair.coupleId).run();
    await db.prepare("UPDATE user SET created_at = ?1 WHERE id IN (?2, ?3)").bind(todayStart + 60, todayPair.owner.id, todayPair.partner.id).run();
    const oldPair = await createPair();
    await db.prepare("UPDATE couples SET created_at = ?1 WHERE id = ?2").bind(todayStart - 8 * DAY, oldPair.coupleId).run();
    await db.prepare("UPDATE user SET created_at = ?1 WHERE id IN (?2, ?3)").bind(todayStart - 8 * DAY, oldPair.owner.id, oldPair.partner.id).run();
    const weekPair = await createPair();
    await db.prepare("UPDATE couples SET created_at = ?1 WHERE id = ?2").bind(todayStart - 3 * DAY, weekPair.coupleId).run();
    await db.prepare("UPDATE user SET created_at = ?1 WHERE id IN (?2, ?3)").bind(todayStart - 3 * DAY, weekPair.owner.id, weekPair.partner.id).run();
    // デモペア（1 人・投稿 2・画像 3）は入らない
    const demo = await createDemoPair();
    await insertPost(demo.coupleId, demo.user.id, 3, todayStart + 10);
    await insertPost(demo.coupleId, demo.user.id, 0, todayStart + 11);
    // paid: 今日 1・週の中で 1・期限切れ 1（数えない）・デモ paid（数えない）
    await setPlanRow(todayPair.coupleId, "paid", "manual", null, todayStart + 5);
    await setPlanRow(weekPair.coupleId, "paid", "stripe", Math.floor(NOW_MS / 1000) + DAY, todayStart - 2 * DAY);
    await setPlanRow(oldPair.coupleId, "paid", "manual", Math.floor(NOW_MS / 1000) - 1, todayStart - 8 * DAY);
    await setPlanRow(demo.coupleId, "paid", "manual", null, todayStart + 1);
    // 投稿: 今日 2（画像 1 + 2）、週の中 1（画像 0）、削除済み 1（数えない。画像 4 も）
    await insertPost(todayPair.coupleId, todayPair.owner.id, 1, todayStart + 100);
    await insertPost(todayPair.coupleId, todayPair.partner.id, 2, todayStart + 200);
    await insertPost(weekPair.coupleId, weekPair.owner.id, 0, todayStart - 1 * DAY);
    const deleted = await insertPost(oldPair.coupleId, oldPair.owner.id, 4, todayStart - 9 * DAY);
    await db.prepare("UPDATE posts SET deleted_at = ?1 WHERE id = ?2").bind(nowSec(), deleted).run();
    // アルバムの写真: 週の中に 4 枚
    await insertAlbumWithPhotos(weekPair.coupleId, weekPair.owner.id, 4, todayStart - 5 * DAY);

    const after = await computeStats(db, NOW_MS);
    const diff = (key: keyof typeof after) => ({
      total: after[key].total - before[key].total,
      today: after[key].today - before[key].today,
      avg7d: Math.round((after[key].avg7d - before[key].avg7d) * 10) / 10,
    });
    expect(diff("couples")).toEqual({ total: 3, today: 1, avg7d: 0.1 });
    expect(diff("users")).toEqual({ total: 6, today: 2, avg7d: 0.3 });
    expect(diff("paidCouples")).toEqual({ total: 2, today: 1, avg7d: 0.1 });
    expect(diff("posts")).toEqual({ total: 3, today: 2, avg7d: 0.1 });
    // 画像: 今日 3（投稿）、週の中 4（アルバム）→ 4/7 = 0.6
    expect(diff("images")).toEqual({ total: 7, today: 3, avg7d: 0.6 });
  });

  it("loadStats は 1 分キャッシュ（同じ値を返し、TTL を過ぎると数え直す）", async () => {
    const first = await loadStats(db, NOW_MS);
    await createPair();
    const cached = await loadStats(db, NOW_MS + 1000);
    expect(cached).toBe(first);
    const fresh = await loadStats(db, NOW_MS + STATS_TTL_MS + 1);
    expect(fresh).not.toBe(first);
    expect(fresh.couples.total).toBe(first.couples.total + 1);
  });

  it("admin.stats（手続き）: 運営が呼べて 5 つの形が揃う", async () => {
    const admin = await createAdmin();
    const stats = await call(router.admin.stats, {}, { context: contextFor(admin) });
    for (const key of ["couples", "users", "paidCouples", "posts", "images"] as const) {
      expect(stats[key]).toEqual({ total: expect.any(Number), today: expect.any(Number), avg7d: expect.any(Number) });
    }
  });
});

describe("057 T3・T6: admin.lookup（完全一致で 1 人。数とプランの行だけ）", () => {
  it("見つかる: 利用者とペアのキーを固定（本文・名前・写真の URL・記念日は無い）。別ペアの数を混ぜない", async () => {
    const admin = await createAdmin();
    const a = await createPair();
    const b = await createPair();
    await insertPost(a.coupleId, a.owner.id, 2, nowSec());
    await insertPost(a.coupleId, a.partner.id, 1, nowSec());
    await insertAlbumWithPhotos(a.coupleId, a.owner.id, 3, nowSec());
    await insertPost(b.coupleId, b.owner.id, 4, nowSec());
    await insertAlbumWithPhotos(b.coupleId, b.owner.id, 9, nowSec());
    await setPlanRow(a.coupleId, "paid", "stripe", nowSec() + 86400);

    const result = await call(router.admin.lookup, { email: a.owner.email }, { context: contextFor(admin) });
    expect(Object.keys(result).sort()).toEqual(["couple", "user"]);
    expect(Object.keys(result.user!).sort()).toEqual(["createdAt", "email", "postImages", "posts"]);
    expect(Object.keys(result.couple!).sort()).toEqual(
      ["albums", "createdAt", "expiresAt", "hasStripeCustomer", "id", "images", "members", "plan", "posts", "source"].sort(),
    );
    expect(result.user).toMatchObject({ email: a.owner.email, posts: 1, postImages: 2 });
    expect(result.couple).toMatchObject({
      id: a.coupleId,
      members: 2,
      plan: "paid",
      source: "stripe",
      hasStripeCustomer: true,
      posts: 2,
      images: 6,
      albums: 1,
    });
    expect(JSON.stringify(result)).not.toContain("本文");
    expect(JSON.stringify(result)).not.toContain(a.owner.name);
    expect(JSON.stringify(result)).not.toContain("https://");
    // 相手側から探しても同じペア
    const partner = await call(router.admin.lookup, { email: a.partner.email }, { context: contextFor(admin) });
    expect(partner.couple?.id).toBe(a.coupleId);
    expect(partner.user).toMatchObject({ posts: 1, postImages: 1 });
  });

  it("見つからない → user も couple も null。未所属の利用者 → couple null。プランの行が無いペア → free・source null", async () => {
    const admin = await createAdmin();
    expect(await call(router.admin.lookup, { email: "nobody@example.com" }, { context: contextFor(admin) })).toEqual({ user: null, couple: null });
    const alone = await createUser();
    const r = await call(router.admin.lookup, { email: alone.email }, { context: contextFor(admin) });
    expect(r.user?.email).toBe(alone.email);
    expect(r.couple).toBeNull();
    const pair = await createPair();
    const p = await call(router.admin.lookup, { email: pair.owner.email }, { context: contextFor(admin) });
    expect(p.couple).toMatchObject({ plan: "free", source: null, expiresAt: null, hasStripeCustomer: false, members: 2 });
  });
});

describe("057 T4: admin.setPlan と admin_actions", () => {
  it("free → paid: source='manual', plan='paid', expires_at NULL。paid → free: plan='free'・updated_at が今。admin_actions に 1 行ずつ（新しい順）", async () => {
    const admin = await createAdmin();
    const { owner, coupleId } = await createPair();
    const ctx = contextFor(admin);
    const before = (await call(router.admin.actions, {}, { context: ctx })).items.length;

    expect(await call(router.admin.setPlan, { coupleId, plan: "paid" }, { context: ctx })).toEqual({ plan: "paid" });
    const paidRow = await db.prepare("SELECT plan, source, expires_at FROM couple_plans WHERE couple_id = ?1").bind(coupleId).first();
    expect(paidRow).toEqual({ plan: "paid", source: "manual", expires_at: null });
    expect((await call(router.couple.get, undefined, { context: contextFor(owner) })).plan).toBe("paid");

    // 前の行の updated_at を過去に置いてから free に戻す（同じ秒だと「今」を区別できない）。047 の猶予の
    // 起点なので、ここで更新されることを固定する
    await db.prepare("UPDATE couple_plans SET updated_at = ?1 WHERE couple_id = ?2").bind(nowSec() - 86400, coupleId).run();
    const t = nowSec();
    expect(await call(router.admin.setPlan, { coupleId, plan: "free" }, { context: ctx })).toEqual({ plan: "free" });
    const freeRow = await db
      .prepare("SELECT plan, source, expires_at, updated_at FROM couple_plans WHERE couple_id = ?1")
      .bind(coupleId)
      .first<{ plan: string; source: string; expires_at: number | null; updated_at: number }>();
    expect(freeRow).toMatchObject({ plan: "free", source: "manual", expires_at: null });
    expect(freeRow!.updated_at).toBeGreaterThanOrEqual(t);
    // 手で free = updated_at が猶予の起点（lockAt あり。047）
    const state = (await call(router.couple.get, undefined, { context: contextFor(owner) })).planState;
    expect(state).toMatchObject({ plan: "free", locked: false });
    expect(state.plan === "free" && state.lockAt).toBeTruthy();

    const { items } = await call(router.admin.actions, {}, { context: ctx });
    expect(items.length).toBe(before + 2);
    expect(items[0]).toMatchObject({ adminEmail: admin.email, action: "plan.set", coupleId });
    expect(JSON.parse(items[0]!.detail)).toEqual({
      from: { plan: "paid", source: "manual", expiresAt: null },
      to: { plan: "free", source: "manual", expiresAt: null },
    });
    expect(JSON.parse(items[1]!.detail)).toEqual({ from: null, to: { plan: "paid", source: "manual", expiresAt: null } });
    expect(Object.keys(items[0]!).sort()).toEqual(["action", "adminEmail", "coupleId", "createdAt", "detail", "id"]);
    // limit は 50 まで
    await expect(call(router.admin.actions, { limit: 51 }, { context: ctx })).rejects.toBeTruthy();
    expect((await call(router.admin.actions, { limit: 1 }, { context: ctx })).items).toHaveLength(1);
  });

  it("source='stripe' の行があれば CONFLICT で、行も記録も変わらない。存在しないペアは NOT_FOUND", async () => {
    const admin = await createAdmin();
    const { coupleId } = await createPair();
    const ctx = contextFor(admin);
    const expires = nowSec() + 86400;
    await setPlanRow(coupleId, "paid", "stripe", expires);
    const before = (await call(router.admin.actions, {}, { context: ctx })).items.length;

    await expect(call(router.admin.setPlan, { coupleId, plan: "free" }, { context: ctx })).rejects.toMatchObject({ code: "CONFLICT" });
    const row = await db.prepare("SELECT plan, source, expires_at FROM couple_plans WHERE couple_id = ?1").bind(coupleId).first();
    expect(row).toEqual({ plan: "paid", source: "stripe", expires_at: expires });
    expect((await call(router.admin.actions, {}, { context: ctx })).items.length).toBe(before);

    await expect(call(router.admin.setPlan, { coupleId: "no-such-couple", plan: "paid" }, { context: ctx })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("057 T8: admin_actions は退会しても残る（FK 無し。couple_id は消えたペアの id のまま）", () => {
  it("記録のあとにペアと利用者の行を消しても、記録は残り admin.actions に出る（adminEmail は退会なら null）", async () => {
    const admin = await createAdmin();
    const { owner, partner, coupleId } = await createPair();
    await call(router.admin.setPlan, { coupleId, plan: "paid" }, { context: contextFor(admin) });
    // me.delete と同じ順で消す（FK の順。admin_actions は触らない）
    await db.batch([
      db.prepare("DELETE FROM couple_plans WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM invites WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM couple_members WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM couples WHERE id = ?1").bind(coupleId),
      db.prepare("DELETE FROM account WHERE user_id IN (?1, ?2)").bind(owner.id, partner.id),
      db.prepare("DELETE FROM user WHERE id IN (?1, ?2)").bind(owner.id, partner.id),
    ]);
    const { items } = await call(router.admin.actions, {}, { context: contextFor(admin) });
    expect(items.find((a) => a.coupleId === coupleId)).toMatchObject({ action: "plan.set", adminEmail: admin.email });
    // 運営自身が退会しても記録は残り、adminEmail が null になる
    await db.batch([db.prepare("DELETE FROM account WHERE user_id = ?1").bind(admin.id), db.prepare("DELETE FROM user WHERE id = ?1").bind(admin.id)]);
    const other = await createAdmin();
    const after = await call(router.admin.actions, {}, { context: contextFor(other) });
    expect(after.items.find((a) => a.coupleId === coupleId)).toMatchObject({ action: "plan.set", adminEmail: null });
  });
});

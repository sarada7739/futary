import { ADMIN_ACTIONS_DEFAULT_LIMIT, PLAN_SOURCES, type AdminCount, type AdminStats, type PlanSource } from "@futary/contract";
import { jstDayRangeMs, todayJst } from "@futary/date";
import { implementer } from "../implementer";
import { loadPlanRow, resolvePlan } from "../lib/plan";
import { generateImageId } from "../lib/ulid";
import { adminProcedure } from "./base";

// 057: 運営の画面（docs/tasks/057-admin.md）。全部 adminProcedure（ADMIN_EMAILS に含まれる認証済みだけ）。
// 線: 触れるのは数（COUNT）と couple_plans の 1 行だけ。本文・写真・名前・記念日は返さない・書かない
// （security-requirements.md 3節）。数以外を出したくなったら出さず A へ

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// --- admin.stats -----------------------------------------------------------------------

const DAY_SECONDS = 24 * 60 * 60;

// 今日（JST 0:00）と、直近 7 日の始まり（今日を含まない）。秒
export function statsWindows(nowMs: number): { todayStart: number; weekStart: number } {
  const todayStart = Math.floor(jstDayRangeMs(todayJst(nowMs)).fromMs / 1000);
  return { todayStart, weekStart: todayStart - 7 * DAY_SECONDS };
}

interface CountRow {
  total: number;
  today: number;
  week: number;
}

function toCount(row: CountRow | null | undefined): AdminCount {
  const week = row?.week ?? 0;
  return { total: row?.total ?? 0, today: row?.today ?? 0, avg7d: Math.round((week / 7) * 10) / 10 };
}

// COUNT と、created_at で「今日の増加」「直近 7 日の増加」を 1 文で数える。デモペア（is_demo = 1）は除く（0節 #6）。
// 「今ある数」で揃える（消したものは数えない。0節 #5）
const COUNT_COLUMNS = (createdAt: string) =>
  `COUNT(*) AS total,
   SUM(CASE WHEN ${createdAt} >= ?1 THEN 1 ELSE 0 END) AS today,
   SUM(CASE WHEN ${createdAt} >= ?2 AND ${createdAt} < ?1 THEN 1 ELSE 0 END) AS week`;

export async function computeStats(db: D1Database, nowMs: number): Promise<AdminStats> {
  const { todayStart, weekStart } = statsWindows(nowMs);
  const results = await db.batch([
    db.prepare(`SELECT ${COUNT_COLUMNS("created_at")} FROM couples WHERE is_demo = 0`).bind(todayStart, weekStart),
    // 利用者 = user。デモペアの利用者は除く
    db
      .prepare(
        `SELECT ${COUNT_COLUMNS("u.created_at")} FROM user u
          WHERE NOT EXISTS (SELECT 1 FROM couple_members cm JOIN couples c ON c.id = cm.couple_id
                             WHERE cm.user_id = u.id AND c.is_demo = 1)`,
      )
      .bind(todayStart, weekStart),
    db
      .prepare(
        `SELECT ${COUNT_COLUMNS("p.created_at")} FROM posts p JOIN couples c ON c.id = p.couple_id
          WHERE p.deleted_at IS NULL AND c.is_demo = 0`,
      )
      .bind(todayStart, weekStart),
    // 投稿の写真（親が未削除）。増加は posts.created_at
    db
      .prepare(
        `SELECT ${COUNT_COLUMNS("p.created_at")} FROM post_images pi
           JOIN posts p ON p.id = pi.post_id JOIN couples c ON c.id = p.couple_id
          WHERE p.deleted_at IS NULL AND c.is_demo = 0`,
      )
      .bind(todayStart, weekStart),
    // アルバムの写真（アルバムが未削除）
    db
      .prepare(
        `SELECT ${COUNT_COLUMNS("ap.created_at")} FROM album_photos ap
           JOIN albums a ON a.id = ap.album_id JOIN couples c ON c.id = a.couple_id
          WHERE a.deleted_at IS NULL AND c.is_demo = 0`,
      )
      .bind(todayStart, weekStart),
    // paid は resolvePlan で判定する（行数は少ない）。増加は updated_at（「paid になった／更新された」の近似）
    db.prepare(
      `SELECT cp.plan AS plan, cp.expires_at AS expires_at, cp.updated_at AS updated_at
         FROM couple_plans cp JOIN couples c ON c.id = cp.couple_id WHERE c.is_demo = 0`,
    ),
  ]);

  // batch の結果は文の順（couples・users・posts・post_images・album_photos・couple_plans）
  const first = <T>(i: number): T | null => (results[i]?.results?.[0] as T | undefined) ?? null;
  const now = Math.floor(nowMs / 1000);
  const paid: CountRow = { total: 0, today: 0, week: 0 };
  for (const row of (results[5]?.results ?? []) as { plan: string; expires_at: number | null; updated_at: number }[]) {
    if (resolvePlan(row, now) !== "paid") continue;
    paid.total += 1;
    if (row.updated_at >= todayStart) paid.today += 1;
    else if (row.updated_at >= weekStart) paid.week += 1;
  }

  const pi = first<CountRow>(3);
  const ap = first<CountRow>(4);
  const images: CountRow = {
    total: (pi?.total ?? 0) + (ap?.total ?? 0),
    today: (pi?.today ?? 0) + (ap?.today ?? 0),
    week: (pi?.week ?? 0) + (ap?.week ?? 0),
  };

  return {
    couples: toCount(first<CountRow>(0)),
    users: toCount(first<CountRow>(1)),
    paidCouples: toCount(paid),
    posts: toCount(first<CountRow>(2)),
    images: toCount(images),
  };
}

// 全体の数は Worker のメモリに 1 分キャッシュ（billing.prices と同じ作法。isolate ごとに空から）。
// Cron・集計表は持たない（0節 #11）
export const STATS_TTL_MS = 60 * 1000;
let statsCache: { at: number; value: AdminStats } | null = null;

export async function loadStats(db: D1Database, nowMs: number): Promise<AdminStats> {
  if (statsCache && nowMs - statsCache.at < STATS_TTL_MS) return statsCache.value;
  const value = await computeStats(db, nowMs);
  statsCache = { at: nowMs, value };
  return value;
}

// テスト用
export function resetStatsCache(): void {
  statsCache = null;
}

const adminStats = implementer.admin.stats.use(adminProcedure).handler(async ({ context }) => {
  return loadStats(context.db, Date.now());
});

// --- admin.lookup ------------------------------------------------------------------------

interface LookupUserRow {
  id: string;
  email: string;
  created_at: number;
  couple_id: string | null;
}

const adminLookup = implementer.admin.lookup.use(adminProcedure).handler(async ({ context, input }) => {
  const { db } = context;
  // 完全一致で 1 人（メールは Better Auth が保存した形のまま比べる）
  const userRow = await db
    .prepare(
      `SELECT u.id AS id, u.email AS email, u.created_at AS created_at, cm.couple_id AS couple_id
         FROM user u LEFT JOIN couple_members cm ON cm.user_id = u.id
        WHERE u.email = ?1`,
    )
    .bind(input.email)
    .first<LookupUserRow>();
  if (!userRow) return { user: null, couple: null };

  // 個人: 投稿数と投稿の写真の数（album_photos に誰が入れたかの列は無い。列は足さない）
  const userCounts = await db
    .prepare(
      `SELECT COUNT(*) AS posts,
              (SELECT COUNT(*) FROM post_images pi JOIN posts p2 ON p2.id = pi.post_id
                WHERE p2.author_id = ?1 AND p2.deleted_at IS NULL) AS post_images
         FROM posts WHERE author_id = ?1 AND deleted_at IS NULL`,
    )
    .bind(userRow.id)
    .first<{ posts: number; post_images: number }>();
  const user = {
    email: userRow.email,
    createdAt: userRow.created_at,
    posts: userCounts?.posts ?? 0,
    postImages: userCounts?.post_images ?? 0,
  };
  if (!userRow.couple_id) return { user, couple: null };

  // ペア: 有無・作成日・人数・プランの行・数（投稿・画像〈投稿 + アルバム〉・アルバム）。名前・記念日は返さない
  const coupleId = userRow.couple_id;
  const [coupleRow, planRow] = await Promise.all([
    db
      .prepare(
        `SELECT c.created_at AS created_at,
                (SELECT COUNT(*) FROM couple_members WHERE couple_id = c.id) AS members,
                (SELECT COUNT(*) FROM posts WHERE couple_id = c.id AND deleted_at IS NULL) AS posts,
                (SELECT COUNT(*) FROM post_images pi JOIN posts p ON p.id = pi.post_id
                  WHERE p.couple_id = c.id AND p.deleted_at IS NULL)
                + (SELECT COUNT(*) FROM album_photos ap JOIN albums a ON a.id = ap.album_id
                    WHERE a.couple_id = c.id AND a.deleted_at IS NULL) AS images,
                (SELECT COUNT(*) FROM albums WHERE couple_id = c.id AND deleted_at IS NULL) AS albums
           FROM couples c WHERE c.id = ?1`,
      )
      .bind(coupleId)
      .first<{ created_at: number; members: number; posts: number; images: number; albums: number }>(),
    loadPlanRow(db, coupleId),
  ]);
  if (!coupleRow) return { user, couple: null };
  const source: PlanSource | null =
    planRow && (PLAN_SOURCES as readonly string[]).includes(planRow.source) ? (planRow.source as PlanSource) : null;
  return {
    user,
    couple: {
      id: coupleId,
      createdAt: coupleRow.created_at,
      members: coupleRow.members,
      plan: resolvePlan(planRow, nowSeconds()),
      source,
      expiresAt: planRow?.expires_at ?? null,
      hasStripeCustomer: planRow?.stripe_customer_id != null,
      posts: coupleRow.posts,
      images: coupleRow.images,
      albums: coupleRow.albums,
    },
  };
});

// --- admin.setPlan -----------------------------------------------------------------------

// paid: source='manual', plan='paid', expires_at NULL。free: plan='free', updated_at を今（047 の猶予の起点）。
// source='stripe' の行があれば CONFLICT（Webhook と食い違う。0節 #9）。全部 admin_actions に残す（0節 #10）
const adminSetPlan = implementer.admin.setPlan.use(adminProcedure).handler(async ({ context, input, errors }) => {
  const { db, user } = context;
  const couple = await db.prepare("SELECT id FROM couples WHERE id = ?1").bind(input.coupleId).first<{ id: string }>();
  if (!couple) throw errors.NOT_FOUND();
  const before = await loadPlanRow(db, input.coupleId);
  if (before?.source === "stripe") throw errors.CONFLICT();

  const now = nowSeconds();
  // id は ULID（ミリ秒の時刻順に並ぶ。同じ秒の 2 件でも admin.actions の「新しい順」が崩れない）
  const actionId = generateImageId();
  const detail = JSON.stringify({
    from: before ? { plan: before.plan, source: before.source, expiresAt: before.expires_at } : null,
    to: { plan: input.plan, source: "manual", expiresAt: null },
  });
  await db.batch([
    db
      .prepare(
        `INSERT INTO couple_plans (couple_id, plan, source, expires_at, updated_at) VALUES (?1, ?2, 'manual', NULL, ?3)
         ON CONFLICT(couple_id) DO UPDATE SET plan = ?2, source = 'manual', expires_at = NULL, updated_at = ?3`,
      )
      .bind(input.coupleId, input.plan, now),
    db
      .prepare(
        `INSERT INTO admin_actions (id, admin_user_id, action, couple_id, detail, created_at) VALUES (?1, ?2, 'plan.set', ?3, ?4, ?5)`,
      )
      .bind(actionId, user.id, input.coupleId, detail, now),
  ]);
  // 0節 #15: Worker のログにも 1 行（id と couple_id の先頭だけ。メールは書かない。security-requirements.md 8節）
  console.log(`[admin.setPlan] action=${actionId} couple=${input.coupleId.slice(0, 8)} plan=${input.plan}`);
  return { plan: input.plan };
});

// --- admin.actions -----------------------------------------------------------------------

interface ActionRow {
  id: string;
  admin_email: string | null;
  action: string;
  couple_id: string;
  detail: string;
  created_at: number;
}

const adminActions = implementer.admin.actions.use(adminProcedure).handler(async ({ context, input }) => {
  const { results } = await context.db
    .prepare(
      `SELECT aa.id AS id, u.email AS admin_email, aa.action AS action, aa.couple_id AS couple_id,
              aa.detail AS detail, aa.created_at AS created_at
         FROM admin_actions aa LEFT JOIN user u ON u.id = aa.admin_user_id
        ORDER BY aa.created_at DESC, aa.id DESC LIMIT ?1`,
    )
    .bind(input.limit ?? ADMIN_ACTIONS_DEFAULT_LIMIT)
    .all<ActionRow>();
  return {
    items: results.map((row) => ({
      id: row.id,
      adminEmail: row.admin_email,
      action: row.action,
      coupleId: row.couple_id,
      detail: row.detail,
      createdAt: row.created_at,
    })),
  };
});

export const adminProcedures = {
  stats: adminStats,
  lookup: adminLookup,
  setPlan: adminSetPlan,
  actions: adminActions,
};

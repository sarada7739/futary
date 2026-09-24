import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export const couples = sqliteTable(
  "couples",
  {
    id: text("id").primaryKey(),
    // 付き合った日。NULL = まだ設定していない（stats.get の daysTogether が 'unset'。023）
    datingDate: text("dating_date"),
    // 結婚した日。NULL 許容（019）
    marriedDate: text("married_date"),
    // ホーム上部に何を表示するか（architecture.md 4節）
    primaryDate: text("primary_date").notNull().default("dating"),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // 未知の値が 1 件でも入ると stats.get の出力検証ごと壊れる（architecture.md 4節）
    check("couples_primary_date_check", sql`${table.primaryDate} IN ('dating', 'married', 'none')`),
    // 下の 2 つの check() は drizzle-kit の差分検出のためだけにある。実際の DB には無く、
    // 実体は 0009_couple_dates.sql の TRIGGER（INSERT・UPDATE の 2 本）。
    // couples は子表を持つので、D1 ではあとから CHECK を足せない（テーブルの作り直しが
    // FK で落ちる。2 列にまたがる CHECK は ADD COLUMN にも付けられない。architecture.md 4節）。
    // 入力スキーマを通らないシードがあるので DB 側にも表す
    check(
      "couples_married_date_required_check",
      sql`${table.primaryDate} <> 'married' OR ${table.marriedDate} IS NOT NULL`,
    ),
    // 結婚が交際開始より前にならない。dating_date が NULL なら比べようがないので通す
    // （結婚した日だけ設定できる。023）
    check(
      "couples_married_after_anniversary_check",
      sql`${table.marriedDate} IS NULL OR ${table.datingDate} IS NULL OR ${table.marriedDate} >= ${table.datingDate}`,
    ),
  ],
);

// slot で 1 ペア 2 人までを DB が担保する（空きが無いと INSERT が失敗する）。
// アプリ側で人数を数えない（architecture.md 4節）
export const coupleMembers = sqliteTable(
  "couple_members",
  {
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id),
    slot: integer("slot").notNull(),
    joinedAt: integer("joined_at", { mode: "timestamp" }).notNull(),
    // 投稿本文を外部の生成AIへ送ることへの個人ごとの同意。2 人とも true のときだけ生成できる（ADR-013）
    aiOptIn: integer("ai_opt_in", { mode: "boolean" }).notNull().default(false),
    // 天気の地域（気象庁の予報区 class10 の 6 桁）。NULL = 未設定。位置情報は取らない（058）
    weatherArea: text("weather_area"),
  },
  (table) => [
    primaryKey({ columns: [table.coupleId, table.userId] }),
    unique().on(table.coupleId, table.slot),
    check("couple_members_slot_check", sql`${table.slot} IN (1, 2)`),
  ],
);

// ペアのプラン。ペアごとに 0〜1 行で、行が無ければ free（LEFT JOIN）。
// couples に列を足さないのは、子表を持つ couples にはあとから CHECK を足せず、決済の列も
// ここへ足せるから（architecture.md 4節）。判定は lib/plan.ts の resolvePlan の 1 箇所（045）
export const couplePlans = sqliteTable("couple_plans", {
  coupleId: text("couple_id")
    .primaryKey()
    .references(() => couples.id),
  // 'free' | 'paid'。未知の値は free として扱う
  plan: text("plan").notNull(),
  // 'manual'（運営）| 'stripe'（Webhook が書く。manual の行は Webhook が触らない）
  source: text("source").notNull().default("manual"),
  // NULL = 無期限。過ぎていれば free。stripe なら current_period_end
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  // subscription は解約後も残す（Portal を開ける・退会時の解約の対象）。
  // UNIQUE は張らない（metadata.couple_id で結び、同じ購読が 2 ペアに付く経路は無い）
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // 「期間の終わりで解約」の終了日時。NULL = 解約していない。画面の文言の出し分けだけに使い、
  // paid かどうかの判定には使わない
  stripeCancelAt: integer("stripe_cancel_at", { mode: "timestamp" }),
});

export const invites = sqliteTable("invites", {
  // 6 桁。紛らわしい文字を除いた英数（apps/api/src/lib/invite-code.ts）
  code: text("code").primaryKey(),
  coupleId: text("couple_id")
    .notNull()
    .references(() => couples.id),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  // 使用済みなら非 NULL。使えるかはこの列を条件に含めた UPDATE の件数で決める（SELECT してから判断しない）
  usedAt: integer("used_at", { mode: "timestamp" }),
});

// invite.accept の失敗の記録（security-requirements.md 4節）。成功は記録しない。
// IP だけだと IPv6 の /64 の中でアドレスを変えるだけで回避できるので、利用者単位のキーも持ち、
// どちらかが閾値を超えたら拒否する。
// 利用者のキーは user.id ではなく Google の sub（削除しても変わらない）の塩付きハッシュ。user.id だと
// 退会・再登録でカウンタが戻る。user への FK も無いので、退会で消す必要も無い（1 時間の窓で切れる）。
// ipAddress は取れない環境では NULL（"unknown" 等の代用文字列だと無関係な利用者が 1 つに合流する）
export const inviteFailures = sqliteTable(
  "invite_failures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountHash: text("account_hash").notNull(),
    ipAddress: text("ip_address"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("invite_failures_account_created_idx").on(table.accountHash, table.createdAt),
    index("invite_failures_ip_created_idx").on(table.ipAddress, table.createdAt),
  ],
);

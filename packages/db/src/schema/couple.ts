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

export const couples = sqliteTable("couples", {
  id: text("id").primaryKey(),
  anniversaryDate: text("anniversary_date").notNull(),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// slot は 1ペア2人までを DB に担保するための列（architecture.md 4節）。
// 空きスロットが無いと INSERT 時に NOT NULL 違反で失敗する仕組みのため、
// アプリケーション側で人数を数える処理を持たない
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
  },
  (table) => [
    primaryKey({ columns: [table.coupleId, table.userId] }),
    unique().on(table.coupleId, table.slot),
    check("couple_members_slot_check", sql`${table.slot} IN (1, 2)`),
  ],
);

export const invites = sqliteTable("invites", {
  // 6桁。紛らわしい文字を除いた英数（apps/api/src/lib/invite-code.ts）
  code: text("code").primaryKey(),
  coupleId: text("couple_id")
    .notNull()
    .references(() => couples.id),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  // 使用済みなら非NULL。未使用/有効期限内の判定はこの列を条件に含めた
  // UPDATE の更新件数で行う（SELECTしてから判断しない）
  usedAt: integer("used_at", { mode: "timestamp" }),
});

// invite.accept の失敗回数を数えるための記録（security-requirements.md 4節）。
// IPだけで絞ると同一/64のIPv6内でアドレスを変えるだけで無制限に回避できるため、
// 認証必須の手続きであることを利用して user_id も併せて記録し、
// どちらかが自分の閾値を超えたら拒否する（security-auditor 004監査 High指摘）。
// ipAddress は取得できない環境（ローカル開発等）では null にする。
// 固定の代用文字列（"unknown"等）を入れると、将来IP単独で集計するコードを
// 足したときに無関係な利用者が同じバケットに合流してしまう
// （security-auditor 004監査2回目 Low指摘）。
// 成功時は記録しない
export const inviteFailures = sqliteTable(
  "invite_failures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    ipAddress: text("ip_address"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("invite_failures_user_created_idx").on(table.userId, table.createdAt),
    index("invite_failures_ip_created_idx").on(table.ipAddress, table.createdAt),
  ],
);

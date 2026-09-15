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
    // 付き合った日。NULL許容（023）。登録時には聞かず、マイページで
    // あとから設定する。旧anniversary_date（NOT NULL）から改名し
    // NULL許容にした。「まだ設定していない」はNULLで表す
    // （stats.getのdaysTogetherが'unset'を返す。packages/contract/src/stats.ts）
    datingDate: text("dating_date"),
    // 結婚した日。NULL許容（019）
    marriedDate: text("married_date"),
    // ホーム上部に何を表示するか。既定は'dating'（019・architecture.md 4節）
    primaryDate: text("primary_date").notNull().default("dating"),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // events.kindと同じ理由。未知の値が1件でも入るとstats.getの出力検証を
    // 巻き込んで壊れる（architecture.md 4節）
    check("couples_primary_date_check", sql`${table.primaryDate} IN ('dating', 'married', 'none')`),
    // primary_date='married'なのにmarried_dateがNULL、という状態を作らない。
    // 入力スキーマでも拒否するが、シードが入力スキーマを通らない2つ目の
    // 書き込み口になるためDB側でも表す（014と同じ理由）。
    //
    // 【重要: 実際のDBにはこのCHECKは存在しない。TRIGGERで代替している】
    // ここに書いてあるdrizzleの`check()`は、drizzle-kitの差分検出（スナップショット
    // 追跡）のためだけに存在し、生成される素のマイグレーションSQLは実際には
    // 使っていない。このスキーマ定義だけを読むと「CHECK制約がある」ように
    // 見えるが、実体は`packages/db/migrations/0009_couple_dates.sql`の
    // `couples_married_date_required_insert`（BEFORE INSERT）・
    // `couples_married_date_required_update`（BEFORE UPDATE）の2本のTRIGGER。
    // 両方無いとINSERT/UPDATEどちらか一方で不変条件を壊せる（片方だけでは
    // 「marriedの行のmarried_dateを後からNULLに落とす」経路等が残る。実測確認済み）。
    //
    // なぜ素のCHECKにできないか: couplesはcouple_members/invites/
    // invite_failures/events/postsからFOREIGN KEYで参照される親テーブル。
    // drizzle-kitはCHECK追加を「新テーブルへ差し替える」手順
    // （PRAGMA foreign_keys=OFF; ...; DROP TABLE）で生成するが、D1はこの
    // PRAGMAを無視して常にFKを強制するため、親テーブルのDROPが
    // FOREIGN KEY constraint failedで落ちる（実測。architecture.md 4節の
    // 「子テーブルを持つ親テーブルには、あとからCHECKを足せない」参照。
    // 「PRAGMA foreign_keys=OFFはD1で無視される」と同根の制約）。
    // 自列だけを参照するprimary_dateのCHECK（上の行）はALTER TABLE ADD COLUMNに
    // そのまま付けられたが、married_dateとの2列にまたがるこちらは同じ理由
    // （テーブル作り直し禁止）でALTER TABLE ADD COLUMNのCHECK句にもできない
    // （自列以外を参照するCHECKは追加できないため）
    check(
      "couples_married_date_required_check",
      sql`${table.primaryDate} <> 'married' OR ${table.marriedDate} IS NOT NULL`,
    ),
    // married_date が dating_date より前にならない（結婚が交際開始より前には
    // ならない）。上と同じ理由（シードが入力スキーマを通らない2つ目の書き込み口に
    // なる）で、入力スキーマだけでなくDB側にも表す（019・Aの決定）。
    // 実体はTRIGGER（上のcouples_married_date_required_checkと同じ事情）。
    // dating_dateがNULL（023: まだ設定していない）のときは比較しようがないため
    // 通す。「付き合った日を覚えていない人が結婚した日だけ設定できる」が
    // 023の要望の本体（docs/tasks/023-anniversary-optional.md）
    check(
      "couples_married_after_anniversary_check",
      sql`${table.marriedDate} IS NULL OR ${table.datingDate} IS NULL OR ${table.marriedDate} >= ${table.datingDate}`,
    ),
  ],
);

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
    // 037: 投稿本文を外部の生成AIへ送ることへの、個人ごとの同意
    // （ADR-013）。2人ともtrueのときだけaiSummary.generateが通る
    aiOptIn: integer("ai_opt_in", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.coupleId, table.userId] }),
    unique().on(table.coupleId, table.slot),
    check("couple_members_slot_check", sql`${table.slot} IN (1, 2)`),
  ],
);

// 045: ペアのプラン（free / paid）。ペアごとに 0〜1 行。**行が無ければ free**
// （SELECT して無ければ free。JOIN は LEFT JOIN）。couples に列を足さない: 決済が来たとき
// 購読 ID・期限・出どころを同じ行に足せる（couples は子表を持つので CHECK もあとから
// 足せない。architecture.md 4節）。CHECK は持たない（027・040・041 と同じ）。
// 判定は apps/api/src/lib/plan.ts の resolvePlan の 1 箇所:
// plan = 'paid' AND (expires_at IS NULL OR expires_at > now) だけが paid。それ以外は全部 free。
// 当面は運営が D1 に手で書く（タスク定義 1節の SQL）。me.delete は couples の行より先にこれを消す
export const couplePlans = sqliteTable("couple_plans", {
  coupleId: text("couple_id")
    .primaryKey()
    .references(() => couples.id),
  // 'free' | 'paid'。未知の値は free として扱う（サーバ）
  plan: text("plan").notNull(),
  // 'manual'（運営が手で）| 'stripe'（048 段階2。Webhook が書く。manual の行は Webhook が触らない）
  source: text("source").notNull().default("manual"),
  // NULL = 無期限。非 NULL で過ぎていれば free として扱う。stripe なら current_period_end
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  // 048 段階2: Stripe の customer（cus_…）と subscription（sub_…）。ペアに customer は 1 つ。
  // subscription は解約後も残す（Portal を開ける・退会時の解約の対象）。UNIQUE は張らない
  // （同じ購読が 2 ペアに付く経路は無い。metadata.couple_id で結ぶ）
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // 「期間の終わりで解約」の終了日時（Stripe の subscription.cancel_at）。NULL = 解約していない。
  // 画面の「〇月〇日に更新」と「〇月〇日まで」の出し分けにだけ使う（paid かどうかの判定には使わない）
  stripeCancelAt: integer("stripe_cancel_at", { mode: "timestamp" }),
});

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
// 認証必須の手続きであることを利用して利用者単位のキーも併せて記録し、
// どちらかが自分の閾値を超えたら拒否する（security-auditor 004監査 High指摘）。
// ipAddress は取得できない環境（ローカル開発等）では null にする。
// 固定の代用文字列（"unknown"等）を入れると、将来IP単独で集計するコードを
// 足したときに無関係な利用者が同じバケットに合流してしまう
// （security-auditor 004監査2回目 Low指摘）。
// 成功時は記録しない。
//
// 【A決定・024】キーは以前 user_id（userへのFK）だった。取り消した理由:
// 024（アカウント削除）でuserを消すとこの表の行もFK制約により一緒に
// 消す必要があり、レート制限のカウンタがリセットされてしまう。
// 「削除→同じGoogleアカウントで再登録（新しいuser.id）→また10回失敗
// できる」を無制限に繰り返せてしまい、下の理由に書いた「user_idを
// 回避するにはGoogleアカウント自体を作り直す必要があり、コストが桁違いに
// 高い」という前提が024で崩れていた（024のsecurity-auditor監査で発見）。
// account.accountId（Googleが払い出すsub。アカウントを削除しても
// 変わらない）の塩付きハッシュに差し替え、userへのFKを外した。
// 副次的に、アカウント削除のときにこの表を消す必要が無くなった
// （時間窓〈1時間〉で自然に切れる。apps/api/src/lib/invite-rate-limit.ts）
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

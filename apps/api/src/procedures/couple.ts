import { implementer } from "../implementer";
import { generateInviteCode } from "../lib/invite-code";
import { hashAccountId } from "../lib/account-hash";
import { albumQuotaFor, loadPlanRow, resolvePlanState } from "../lib/plan";
import { resolveIsAdmin } from "../middleware/auth-context";
import { DEMO_WEATHER_AREA } from "./weather";
import { PLAN_SOURCES, weatherAreaName, type PlanSource } from "@futary/contract";
import { authedProcedure, readProcedure, writeProcedure } from "./base";

const INVITE_TTL_SECONDS = 24 * 60 * 60;
// account_hash はアカウントごとの上限（security-requirements.md 4節）。IP は CGNAT（モバイル回線等）で
// 無関係な利用者が同じ IP を共有するので、緩めにする
const INVITE_FAILURE_USER_LIMIT = 10;
const INVITE_FAILURE_IP_LIMIT = 50;
const INVITE_FAILURE_WINDOW_SECONDS = 60 * 60;
const INVITE_CODE_MAX_ATTEMPTS = 5;

interface CoupleRow {
  id: string;
  dating_date: string | null;
  married_date: string | null;
  primary_date: string;
  created_at: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toCouple(row: CoupleRow) {
  return {
    id: row.id,
    datingDate: row.dating_date,
    marriedDate: row.married_date,
    primaryDate: row.primary_date as "dating" | "married" | "none",
    createdAt: row.created_at,
  };
}

const COUPLE_COLUMNS =
  "id AS id, dating_date AS dating_date, married_date AS married_date, " +
  "primary_date AS primary_date, created_at AS created_at";

// D1 は batch() を文のエラーでロールバックする（architecture.md 4節）。制約違反（CHECK・NOT NULL・
// UNIQUE）は種別を区別せずこれで見分ける
export function isConstraintViolation(error: unknown): boolean {
  return error instanceof Error && /constraint failed/i.test(error.message);
}

// 未所属の利用者が呼ぶので、未所属を NEEDS_ONBOARDING で弾く readProcedure/writeProcedure ではなく
// authedProcedure に載せる（invite.accept も同じ）
const coupleCreate = implementer.couple.create
  .use(authedProcedure)
  .handler(async ({ context, errors }) => {
    const { db } = context;
    const id = crypto.randomUUID();
    const now = nowSeconds();

    try {
      await db.batch([
        // 付き合った日は聞かない（答えられない質問を必須にしない。023）
        db
          .prepare("INSERT INTO couples (id, is_demo, created_at) VALUES (?1, 0, ?2)")
          .bind(id, now),
        db
          .prepare(
            "INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES (?1, ?2, 1, ?3)",
          )
          .bind(id, context.user.id, now),
      ]);
    } catch (error) {
      // couple_members.user_id の UNIQUE 違反 = 既に別のペアに所属している
      if (isConstraintViolation(error)) throw errors.FORBIDDEN();
      throw error;
    }

    // 日付は DB の既定値のまま（dating_date・married_date は NULL、primary_date は 'dating'）
    return { id, datingDate: null, marriedDate: null, primaryDate: "dating" as const, createdAt: now };
  });

// ctx.coupleId はミドルウェアが解決済み（未認証ならデモペア、認証済みなら所属ペア）
const coupleGet = implementer.couple.get.use(readProcedure).handler(async ({ context }) => {
  const row = await context.db
    .prepare(`SELECT ${COUPLE_COLUMNS} FROM couples WHERE id = ?1`)
    .bind(context.coupleId)
    .first<CoupleRow>();

  // readProcedure が couple_id を確定させた時点で存在する想定
  if (!row) throw new Error("couple_id に対応するペアが見つかりません");
  // 自分の天気の地域（ゲストは東京地方で固定。058）
  const weatherAreaCode =
    context.userId === null
      ? DEMO_WEATHER_AREA
      : ((
          await context.db
            .prepare("SELECT weather_area AS weather_area FROM couple_members WHERE couple_id = ?1 AND user_id = ?2")
            .bind(context.coupleId, context.userId)
            .first<{ weather_area: string | null }>()
        )?.weather_area ?? null);
  const weatherAreaLabel = weatherAreaCode ? weatherAreaName(weatherAreaCode) : null;
  const planRow = await loadPlanRow(context.db, context.coupleId);
  // プラン・猶予・鍵の判定は lib/plan.ts の 1 箇所。ゲストにも返す（シードで paid）。
  // albumQuota.used は鍵の分も数える（047）
  const planState = resolvePlanState(planRow, nowSeconds());
  const plan = planState.plan;
  const albumQuota = await albumQuotaFor(context.db, context.coupleId, plan);
  // 出どころと期限はマイページの文言とボタンの出し分けに使う。未知の source は null
  // （画面が Portal のボタンを出さない側に倒す）
  const planSource: PlanSource | null =
    planRow && (PLAN_SOURCES as readonly string[]).includes(planRow.source) ? (planRow.source as PlanSource) : null;
  return {
    ...toCouple(row),
    plan,
    albumQuota,
    planState,
    planSource,
    planExpiresAt: planRow?.expires_at ?? null,
    planCancelAt: planRow?.stripe_cancel_at ?? null,
    // 判定は middleware/auth-context.ts の 1 箇所（057）
    isAdmin: resolveIsAdmin(context),
    weatherArea: weatherAreaCode && weatherAreaLabel ? { code: weatherAreaCode, name: weatherAreaLabel } : null,
  };
});

// 'married' なのに married_date が NULL は DB の TRIGGER で弾かれる（schema/couple.ts）。
// 入力スキーマで通常は届かないが、届いたら INVALID_INPUT にする
const coupleUpdate = implementer.couple.update.use(writeProcedure).handler(async ({ context, input, errors }) => {
  let row: CoupleRow | null;
  try {
    row = await context.db
      .prepare(
        `UPDATE couples
            SET dating_date = ?1, married_date = ?2, primary_date = ?3
          WHERE id = ?4
          RETURNING ${COUPLE_COLUMNS}`,
      )
      .bind(input.datingDate, input.marriedDate, input.primaryDate, context.coupleId)
      .first<CoupleRow>();
  } catch (error) {
    if (isConstraintViolation(error)) throw errors.INVALID_INPUT();
    throw error;
  }

  if (!row) throw new Error("couple_id に対応するペアが見つかりません");
  return toCouple(row);
});

const inviteIssue = implementer.invite.issue.use(writeProcedure).handler(async ({ context, errors }) => {
  const { db, coupleId, userId } = context;
  const now = nowSeconds();
  const expiresAt = now + INVITE_TTL_SECONDS;

  // 人数は DB の slot が担保するので普段は数えないが、その制約は参加の瞬間にしか効かない。
  // 満員のペアでも発行自体は通ってしまうので、ここで数えて拒む（画面に出さないだけに頼らない。
  // security-requirements.md T5）
  const memberCount = await db
    .prepare("SELECT COUNT(*) AS count FROM couple_members WHERE couple_id = ?1")
    .bind(coupleId)
    .first<{ count: number }>();
  if ((memberCount?.count ?? 0) >= 2) throw errors.FORBIDDEN();

  for (let attempt = 1; attempt <= INVITE_CODE_MAX_ATTEMPTS; attempt++) {
    const code = generateInviteCode();
    try {
      await db.batch([
        // 同時に有効なコードは 1 件だけ（再発行で前のコードを無効にする）
        db
          .prepare("UPDATE invites SET used_at = ?1 WHERE couple_id = ?2 AND used_at IS NULL")
          .bind(now, coupleId),
        db
          .prepare(
            "INSERT INTO invites (code, couple_id, created_by, expires_at, used_at) VALUES (?1, ?2, ?3, ?4, NULL)",
          )
          .bind(code, coupleId, userId, expiresAt),
      ]);
      return { code, expiresAt };
    } catch (error) {
      // code の PK 衝突（1 億通り以上なので極めて稀）。生成し直す
      const isLastAttempt = attempt === INVITE_CODE_MAX_ATTEMPTS;
      if (isConstraintViolation(error) && !isLastAttempt) continue;
      throw error;
    }
  }
  // ループは必ず return か throw で終わるため到達しない
  throw new Error("招待コードの発行に失敗しました");
});

// 数えてから書く、を 1 文にまとめて閾値の判定と記録を原子にする（分けると並行リクエストが全部通る）。
// D1 は文を順番に実行するので、この 1 文が直列化点になる。
// キーは IP と account_hash の両方（IPv6 の /64 の中でアドレスを変えるだけの回避を防ぐ）
async function reserveInviteFailureSlot(
  db: D1Database,
  accountHash: string,
  ip: string | null,
  now: number,
  windowStart: number,
): Promise<number | null> {
  // IP が取れない環境では NULL にして account_hash だけで判定する（代用文字列だと無関係な利用者が合流する）
  const stmt = ip
    ? db
        .prepare(
          `INSERT INTO invite_failures (account_hash, ip_address, created_at)
           SELECT ?1, ?2, ?3
            WHERE (SELECT COUNT(*) FROM invite_failures WHERE account_hash = ?1 AND created_at > ?4) < ?5
              AND (SELECT COUNT(*) FROM invite_failures WHERE ip_address = ?2 AND created_at > ?4) < ?6
           RETURNING id`,
        )
        .bind(accountHash, ip, now, windowStart, INVITE_FAILURE_USER_LIMIT, INVITE_FAILURE_IP_LIMIT)
    : db
        .prepare(
          `INSERT INTO invite_failures (account_hash, ip_address, created_at)
           SELECT ?1, NULL, ?2
            WHERE (SELECT COUNT(*) FROM invite_failures WHERE account_hash = ?1 AND created_at > ?3) < ?4
           RETURNING id`,
        )
        .bind(accountHash, now, windowStart, INVITE_FAILURE_USER_LIMIT);
  const row = await stmt.first<{ id: number }>();
  return row?.id ?? null;
}

// 未所属の利用者が呼ぶ（couple.create と同じく authedProcedure）
const inviteAccept = implementer.invite.accept.use(authedProcedure).handler(async ({ context, input, errors }) => {
  const { db } = context;
  const userId = context.user.id;
  const now = nowSeconds();
  const windowStart = now - INVITE_FAILURE_WINDOW_SECONDS;

  await db.prepare("DELETE FROM invite_failures WHERE created_at <= ?1").bind(windowStart).run();

  // キーは user_id でなく Google アカウント（account_id）の塩付きハッシュ。退会・再登録で
  // user_id は変わるが account_id は変わらないので、繰り返しで回避できない（schema/couple.ts）。
  // Google ログインだけなので、認証済みなら google の account 行が必ず 1 件ある
  const accountRow = await db
    .prepare("SELECT account_id FROM account WHERE user_id = ?1 AND provider_id = 'google'")
    .bind(userId)
    .first<{ account_id: string }>();
  if (!accountRow) throw new Error("認証済みユーザーにGoogleアカウントの紐付けが見つかりません");
  const accountHash = await hashAccountId(context.authSecret, accountRow.account_id);

  // 先に「1 回分の失敗」を予約し、参加が成立したら取り消す（成功は数えない。security-requirements.md 4節）
  const pendingFailureId = await reserveInviteFailureSlot(
    db,
    accountHash,
    context.ip,
    now,
    windowStart,
  );
  if (pendingFailureId === null) {
    throw errors.RATE_LIMITED();
  }

  let insertResult: D1Result<{ couple_id: string }>;
  try {
    // 文1: 招待が未使用・期限内のときだけ空きスロットへ参加する
    // 文2: 招待を消費する（文1と同じ条件。期限切れのコードで used_at だけが刻まれない）。
    //      batch は 2 文をまとめて投げるので、判定は挿入件数と例外の有無で後から行う
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO couple_members (couple_id, user_id, slot, joined_at)
           SELECT i.couple_id,
                  ?1,
                  (SELECT MIN(s.n)
                     FROM (SELECT 1 AS n UNION ALL SELECT 2) s
                    WHERE s.n NOT IN (SELECT m.slot FROM couple_members m WHERE m.couple_id = i.couple_id)),
                  ?2
             FROM invites i
            WHERE i.code = ?3 AND i.used_at IS NULL AND i.expires_at > ?2
           RETURNING couple_id`,
        )
        .bind(userId, now, input.code),
      db
        .prepare(
          "UPDATE invites SET used_at = ?1 WHERE code = ?2 AND used_at IS NULL AND expires_at > ?1",
        )
        .bind(now, input.code),
    ]);
    insertResult = results[0] as D1Result<{ couple_id: string }>;
  } catch (error) {
    // slot の NOT NULL 違反（満員）・user_id の UNIQUE 違反（別ペアに所属）。区別して返すと
    // コードが有効かを外から判別できるので、下の「0 件」と同じ NOT_FOUND にする
    if (isConstraintViolation(error)) throw errors.NOT_FOUND();
    throw error;
  }

  if (insertResult.meta.changes === 0) {
    // コードが無効・期限切れ・使用済み
    throw errors.NOT_FOUND();
  }

  // 参加が成立したので、予約した失敗を外す
  await db.prepare("DELETE FROM invite_failures WHERE id = ?1").bind(pendingFailureId).run();

  const coupleId = insertResult.results[0]?.couple_id;
  const coupleRow = await db
    .prepare(`SELECT ${COUPLE_COLUMNS} FROM couples WHERE id = ?1`)
    .bind(coupleId)
    .first<CoupleRow>();
  if (!coupleRow) throw new Error("参加したペアが見つかりません");

  return toCouple(coupleRow);
});

export const coupleProcedures = {
  create: coupleCreate,
  get: coupleGet,
  update: coupleUpdate,
};

export const inviteProcedures = {
  issue: inviteIssue,
  accept: inviteAccept,
};

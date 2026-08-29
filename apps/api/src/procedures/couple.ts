import { implementer } from "../implementer";
import { generateInviteCode } from "../lib/invite-code";
import { authedProcedure, readProcedure, writeProcedure } from "./base";

const INVITE_TTL_SECONDS = 24 * 60 * 60;
// user_id 単位はアカウントごとの上限（security-requirements.md 4節の基準そのもの）。
// ip_address 単位はCGNAT配下（モバイル回線等）で無関係な利用者が同じIPを共有する
// ことを考慮し、user_id より緩い上限にする
// （security-auditor 004監査2回目 Low指摘）
const INVITE_FAILURE_USER_LIMIT = 10;
const INVITE_FAILURE_IP_LIMIT = 50;
const INVITE_FAILURE_WINDOW_SECONDS = 60 * 60;
const INVITE_CODE_MAX_ATTEMPTS = 5;

interface CoupleRow {
  id: string;
  anniversary_date: string;
  created_at: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toCouple(row: CoupleRow) {
  return { id: row.id, anniversaryDate: row.anniversary_date, createdAt: row.created_at };
}

// D1 は batch() を文のエラーでロールバックする（architecture.md 4節）。
// couple_members の CHECK/NOT NULL/UNIQUE 違反はすべてここに来るため、
// 種別を区別せず一律 FORBIDDEN として扱う（invite.accept の判定表と同じ）。
// post.ts の image_key UNIQUE 制約違反判定でも同じ形を使うため export する
export function isConstraintViolation(error: unknown): boolean {
  return error instanceof Error && /constraint failed/i.test(error.message);
}

// couple.create はまだどのペアにも所属していない認証済みユーザーが呼ぶ操作。
// readProcedure/writeProcedure は「未所属なら NEEDS_ONBOARDING」で弾くため、
// 未所属であることが前提のこの手続きには載せられない（invite.accept も同様）。
// 認証必須だけを課す authedProcedure の上に載せる（context.user は非 null に絞り込まれる）
const coupleCreate = implementer.couple.create
  .use(authedProcedure)
  .handler(async ({ context, input, errors }) => {
    const { db } = context;
    const id = crypto.randomUUID();
    const now = nowSeconds();

    try {
      await db.batch([
        db
          .prepare(
            "INSERT INTO couples (id, anniversary_date, is_demo, created_at) VALUES (?1, ?2, 0, ?3)",
          )
          .bind(id, input.anniversaryDate, now),
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

    return { id, anniversaryDate: input.anniversaryDate, createdAt: now };
  });

// ctx.coupleId はミドルウェアが解決済み（未認証ならデモペア、認証済みなら所属ペア）
const coupleGet = implementer.couple.get.use(readProcedure).handler(async ({ context }) => {
  const row = await context.db
    .prepare(
      "SELECT id AS id, anniversary_date AS anniversary_date, created_at AS created_at FROM couples WHERE id = ?1",
    )
    .bind(context.coupleId)
    .first<CoupleRow>();

  // readProcedure が couple_id を確定させた時点で存在は保証されている想定
  // （005時点でデモペアは未作成のため DEMO_COUPLE_ID は空文字＝ここには来ない）
  if (!row) throw new Error("couple_id に対応するペアが見つかりません");
  return toCouple(row);
});

const coupleUpdate = implementer.couple.update.use(writeProcedure).handler(async ({ context, input }) => {
  const row = await context.db
    .prepare(
      `UPDATE couples
          SET anniversary_date = ?1
        WHERE id = ?2
        RETURNING id AS id, anniversary_date AS anniversary_date, created_at AS created_at`,
    )
    .bind(input.anniversaryDate, context.coupleId)
    .first<CoupleRow>();

  if (!row) throw new Error("couple_id に対応するペアが見つかりません");
  return toCouple(row);
});

const inviteIssue = implementer.invite.issue.use(writeProcedure).handler(async ({ context }) => {
  const { db, coupleId, userId } = context;
  const now = nowSeconds();
  const expiresAt = now + INVITE_TTL_SECONDS;

  for (let attempt = 1; attempt <= INVITE_CODE_MAX_ATTEMPTS; attempt++) {
    const code = generateInviteCode();
    try {
      await db.batch([
        // 同時に有効なコードは1件だけにする（再発行で前のコードを無効化）
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
      // code の PK 衝突（1億通り以上の空間で極めて稀）。生成し直す
      const isLastAttempt = attempt === INVITE_CODE_MAX_ATTEMPTS;
      if (isConstraintViolation(error) && !isLastAttempt) continue;
      throw error;
    }
  }
  // ループは必ず return か throw で終わるため到達しない
  throw new Error("招待コードの発行に失敗しました");
});

// 失敗回数の「数えてから書く」を1文にまとめ、閾値チェックと記録を原子化する
// （security-auditor 004監査 Medium指摘: check-then-insertのTOCTOU）。
// D1は単一の接続に対して文を順番に実行するため、この1文自体が
// 並行リクエスト間の直列化点になる。
// キーはIPだけでなくuser_idも併用する（同一/64のIPv6内でアドレスを変えるだけの
// 回避を防ぐ。security-auditor 004監査 High指摘）。invite.acceptは認証必須なので
// user_idは必ず取れる
async function reserveInviteFailureSlot(
  db: D1Database,
  userId: string,
  ip: string | null,
  now: number,
  windowStart: number,
): Promise<number | null> {
  // IPが取れない環境（ローカル開発等）では ip_address に null を入れ、
  // user_id 単独で判定する。固定の代用文字列を入れると、将来IP単独で
  // 集計するコードを足したときに無関係な利用者が同じバケットに合流してしまう
  // （security-auditor 004監査2回目 Low指摘）
  const stmt = ip
    ? db
        .prepare(
          `INSERT INTO invite_failures (user_id, ip_address, created_at)
           SELECT ?1, ?2, ?3
            WHERE (SELECT COUNT(*) FROM invite_failures WHERE user_id = ?1 AND created_at > ?4) < ?5
              AND (SELECT COUNT(*) FROM invite_failures WHERE ip_address = ?2 AND created_at > ?4) < ?6
           RETURNING id`,
        )
        .bind(userId, ip, now, windowStart, INVITE_FAILURE_USER_LIMIT, INVITE_FAILURE_IP_LIMIT)
    : db
        .prepare(
          `INSERT INTO invite_failures (user_id, ip_address, created_at)
           SELECT ?1, NULL, ?2
            WHERE (SELECT COUNT(*) FROM invite_failures WHERE user_id = ?1 AND created_at > ?3) < ?4
           RETURNING id`,
        )
        .bind(userId, now, windowStart, INVITE_FAILURE_USER_LIMIT);
  const row = await stmt.first<{ id: number }>();
  return row?.id ?? null;
}

// invite.accept はまだどのペアにも所属していない認証済みユーザーが呼ぶ操作
// （couple.create と同じ理由で authedProcedure の上に載せる）
const inviteAccept = implementer.invite.accept.use(authedProcedure).handler(async ({ context, input, errors }) => {
  const { db } = context;
  const userId = context.user.id;
  const now = nowSeconds();
  const windowStart = now - INVITE_FAILURE_WINDOW_SECONDS;

  await db.prepare("DELETE FROM invite_failures WHERE created_at <= ?1").bind(windowStart).run();

  // この時点で「1回分の失敗」を先に予約する。最終的に参加が成立したら後で取り消す
  // （成功した試行はレート制限にカウントしない。security-requirements.md 4節）
  const pendingFailureId = await reserveInviteFailureSlot(
    db,
    userId,
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
    // 文2: 招待を消費する（文1と同じ条件を課し、期限切れコードで used_at だけが
    //      刻まれる状態を作らない）。文1の結果を見て文2を止めることはできない
    //      （batch は2文をまとめて投げる。判定は挿入件数と例外の有無で後から行う）
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
    // slot の NOT NULL 違反（ペアが既に2人）/ user_id の UNIQUE 違反（既に別ペアに所属）。
    // 種別を区別して返すとコードの有効性が外部から判別できてしまうため、
    // 下の「0件」判定と同じ NOT_FOUND に一本化する（security-auditor 004監査 Low指摘）
    if (isConstraintViolation(error)) throw errors.NOT_FOUND();
    throw error;
  }

  if (insertResult.meta.changes === 0) {
    // コードが無効・期限切れ・使用済み
    throw errors.NOT_FOUND();
  }

  // 参加が成立したので、先に予約した失敗をレート制限のカウントから外す
  await db.prepare("DELETE FROM invite_failures WHERE id = ?1").bind(pendingFailureId).run();

  const coupleId = insertResult.results[0]?.couple_id;
  const coupleRow = await db
    .prepare(
      "SELECT id AS id, anniversary_date AS anniversary_date, created_at AS created_at FROM couples WHERE id = ?1",
    )
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

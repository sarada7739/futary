import { MAX_WANT_TITLE_LENGTH } from "@futary/contract";
import { implementer } from "../implementer";
import { fetchLinkPreview, type FetchLike } from "../lib/link-preview";
import {
  createGetUrl,
  createPutUrl,
  MAX_IMAGE_BYTES,
  wantImageKeyFor,
  type R2SignConfig,
} from "../lib/r2-signed-url";
import { generateImageId } from "../lib/ulid";
import { canonicalAmazonUrl, normalizeWantUrl } from "../lib/want-url";
import { isConstraintViolation } from "./couple";
import { readProcedure, writeProcedure } from "./base";

// 1 人 100 件（未削除・手に入れた分を含む）。上限を持ってページングを持たない（040）
const MAX_WANTS_PER_OWNER = 100;

// 手で付ける経路は JPEG のみ（契約の z.literal と同じ値）。署名付き PUT URL は Content-Type を
// 強制できないので、実体を確かめるときに見る
const UPLOAD_CONTENT_TYPE = "image/jpeg";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface WantRow {
  id: string;
  owner_id: string;
  owner_name: string | null;
  title: string;
  url: string | null;
  note: string;
  image_key: string | null;
  created_at: number;
  obtained_at: number | null;
}

// owner を LEFT JOIN で名前にする。wants を couple_id で絞った結果に対して行い、user 側を起点に
// 引かない（認可の範囲を JOIN で広げない）
const WANT_COLUMNS =
  "wants.id AS id, wants.owner_id AS owner_id, user.name AS owner_name, wants.title AS title, " +
  "wants.url AS url, wants.note AS note, wants.image_key AS image_key, wants.created_at AS created_at, " +
  "wants.obtained_at AS obtained_at";
const WANT_FROM = "wants LEFT JOIN user ON user.id = wants.owner_id";

// owner_id は出さず isMine と ownerName にする。画像は署名付き GET URL を都度発行する
async function toWant(row: WantRow, viewerUserId: string | null, r2Sign: R2SignConfig) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    note: row.note,
    image: row.image_key ? { url: await createGetUrl(r2Sign, row.image_key) } : null,
    isMine: viewerUserId !== null && row.owner_id === viewerUserId,
    ownerName: row.owner_name,
    obtainedAt: row.obtained_at,
    createdAt: row.created_at,
  };
}

// 本人の行を 1 件。本人でない・他ペア・存在しない・削除済みは区別せず null（存在を教えない）
async function fetchMine(db: D1Database, coupleId: string, userId: string, id: string): Promise<WantRow | null> {
  return db
    .prepare(
      `SELECT ${WANT_COLUMNS} FROM ${WANT_FROM}
        WHERE wants.id = ?1 AND wants.couple_id = ?2 AND wants.owner_id = ?3 AND wants.deleted_at IS NULL`,
    )
    .bind(id, coupleId, userId)
    .first<WantRow>();
}

// R2 のエラーメッセージは画像キーを含みうるので、詰め替えて投げる（withErrorId がログに出す。
// security-requirements.md 8節）
async function headOrThrow(bucket: R2Bucket, key: string): Promise<R2Object | null> {
  try {
    return await bucket.head(key);
  } catch {
    throw new Error("R2からの画像実体確認に失敗しました");
  }
}

async function deleteQuietly(bucket: R2Bucket, key: string): Promise<void> {
  try {
    await bucket.delete(key);
  } catch {
    // 掃除の失敗で利用者の操作を失敗させない。孤児は architecture.md 6節の回収手順の対象。キーはログに出さない
  }
}

// 手で付けた画像の実体を確かめて鍵を返す。無い・型やサイズが違うなら INVALID_INPUT。
// 違反した実体は消す（残すと同じ imageId を二度と使えない孤児になる）
async function verifyUploadedImage(
  bucket: R2Bucket,
  key: string,
  invalidInput: () => Error,
): Promise<string> {
  const head = await headOrThrow(bucket, key);
  if (!head) throw invalidInput();
  if (head.size > MAX_IMAGE_BYTES || head.httpMetadata?.contentType !== UPLOAD_CONTENT_TYPE) {
    await deleteQuietly(bucket, key);
    throw invalidInput();
  }
  return key;
}

// 取得の失敗理由はログにだけ残す（6節）。利用者の書いた URL と画像キーは書かない
function logPreviewFailures(failures: readonly string[]): void {
  if (failures.length === 0) return;
  console.warn(`[want.create] 画像の自動取得に失敗: ${failures.join(" / ")}`);
}

// テストで fetch を差し替えるためのモジュール変数（秘密ではないので context の形は変えない）
let fetchForPreview: FetchLike | undefined;
export function setLinkPreviewFetchForTest(fetchImpl: FetchLike | undefined): void {
  fetchForPreview = fetchImpl;
}

// ownerSide を owner_id に解決する（ユーザー ID を引数に取らない）。未削除のみ。
// 手に入れていないものが先、手に入れたものが末尾。それぞれ新しい順
const wantList = implementer.want.list.use(readProcedure).handler(async ({ context, input }) => {
  const { db, coupleId, userId, r2Sign } = context;

  // me は本人、partner は自分以外の 1 人。デモ閲覧（userId が null）は partner = slot 1・me = slot 2
  // （2 人分を見られる。書けないのは writeProcedure が守る。isMine は常に false）
  let ownerId: string | null;
  if (userId === null) {
    const row = await db
      .prepare(`SELECT user_id AS user_id FROM couple_members WHERE couple_id = ?1 AND slot = ?2`)
      .bind(coupleId, input.ownerSide === "partner" ? 1 : 2)
      .first<{ user_id: string }>();
    ownerId = row?.user_id ?? null;
  } else if (input.ownerSide === "me") {
    ownerId = userId;
  } else {
    const row = await db
      .prepare(`SELECT user_id AS user_id FROM couple_members WHERE couple_id = ?1 AND user_id != ?2 LIMIT 1`)
      .bind(coupleId, userId)
      .first<{ user_id: string }>();
    ownerId = row?.user_id ?? null;
  }
  if (!ownerId) return { items: [], ownerName: null };

  const ownerRow = await db.prepare(`SELECT name AS name FROM user WHERE id = ?1`).bind(ownerId).first<{ name: string }>();

  const { results } = await db
    .prepare(
      `SELECT ${WANT_COLUMNS} FROM ${WANT_FROM}
        WHERE wants.couple_id = ?1 AND wants.owner_id = ?2 AND wants.deleted_at IS NULL
        ORDER BY (wants.obtained_at IS NULL) DESC, wants.created_at DESC, wants.id DESC`,
    )
    .bind(coupleId, ownerId)
    .all<WantRow>();

  const items = await Promise.all(results.map((row) => toWant(row, userId, r2Sign)));
  return { items, ownerName: ownerRow?.name ?? null };
});

// 上限判定（COUNT）と挿入は 2 文に分かれる（少し超えうるが受け入れる）。
// url があり imageId が無ければ画像の自動取得を試す（同期に最大 12 秒待つ）。
// 取れなくても保存は成功させる（image が null なだけ）
const wantCreate = implementer.want.create.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, coupleId, userId, r2Sign } = context;

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS count FROM wants WHERE couple_id = ?1 AND owner_id = ?2 AND deleted_at IS NULL`)
    .bind(coupleId, userId)
    .first<{ count: number }>();
  if ((countRow?.count ?? 0) >= MAX_WANTS_PER_OWNER) throw errors.LIMIT_REACHED();

  let url = input.url !== undefined ? normalizeWantUrl(input.url) : null;
  const note = input.note ?? "";

  let imageKey: string | null = null;
  let title = input.title ?? null;

  if (input.imageId) {
    // 実体を確かめてから行を書く（architecture.md 6節）
    imageKey = await verifyUploadedImage(bucket, wantImageKeyFor(coupleId, input.imageId, "jpg"), () =>
      errors.INVALID_INPUT(),
    );
  }

  if (url && (!imageKey || !title)) {
    // 画像か題名が無いときだけ外へ取りに行く（外へ出るのは want.create のときだけ。6節）
    const preview = await fetchLinkPreview(url, {
      fetchImpl: fetchForPreview,
      maxTitleLength: MAX_WANT_TITLE_LENGTH,
      needImage: !imageKey,
    });
    logPreviewFailures(preview.failures);
    // 正規化は最終 URL に対して行う。amzn.asia の短縮 URL が /dp/{ASIN} に着いたら正規形を保存する。
    // Amazon 以外・読めなかったときは元の URL のまま
    const canonical = preview.finalUrl ? canonicalAmazonUrl(preview.finalUrl) : null;
    if (canonical) url = canonical;
    if (!title && preview.title) title = preview.title;
    if (!imageKey && preview.image) {
      // 取った画像は R2 に置いて署名付き URL で出す（外部 URL を img-src に足さない。6節）
      const key = wantImageKeyFor(coupleId, generateImageId(), preview.image.extension);
      try {
        await bucket.put(key, preview.image.bytes, { httpMetadata: { contentType: preview.image.contentType } });
        imageKey = key;
      } catch {
        // R2 に置けなくても保存は成功させる（画像無し）。キーはログに出さない
        console.warn("[want.create] 取得した画像を R2 に保存できなかった");
      }
    }
  }

  // 題名も og:title も無ければ URL のホスト名（空の行を作らない）。契約で title か url は必ずある
  if (!title) title = new URL(url as string).hostname;

  const id = crypto.randomUUID();
  const now = nowSeconds();
  try {
    await db
      .prepare(
        `INSERT INTO wants (id, couple_id, owner_id, title, url, note, image_key, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(id, coupleId, userId, title, url, note, imageKey, now)
      .run();
  } catch (error) {
    // wants.image_key の UNIQUE 違反 = 同じ imageId が既に別の行で使われている
    if (isConstraintViolation(error)) throw errors.INVALID_INPUT();
    throw error;
  }

  // mode="member" なら context.user は必ず非 null（auth-context.ts）
  const ownerName = context.user!.name;
  return toWant(
    { id, owner_id: userId, owner_name: ownerName, title, url, note, image_key: imageKey, created_at: now, obtained_at: null },
    userId,
    r2Sign,
  );
});

// 本人のみ。WHERE に couple_id と owner_id を含めた 1 文で、更新 0 件は区別せず NOT_FOUND。
// URL を変えても画像は取り直さない
const wantUpdate = implementer.want.update.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, userId, r2Sign } = context;

  const url = input.url === null ? null : normalizeWantUrl(input.url);
  const updated = await db
    .prepare(
      `UPDATE wants SET title = ?1, url = ?2, note = ?3
        WHERE id = ?4 AND couple_id = ?5 AND owner_id = ?6 AND deleted_at IS NULL
       RETURNING id AS id`,
    )
    .bind(input.title, url, input.note, input.id, coupleId, userId)
    .first<{ id: string }>();
  if (!updated) throw errors.NOT_FOUND();

  const row = await fetchMine(db, coupleId, userId, input.id);
  if (!row) throw errors.NOT_FOUND();
  return toWant(row, userId, r2Sign);
});

// 手で付ける・外す（null）。本人のみ。付け替え・外すときは前のオブジェクトを消す（行と実体を 1 対 1 に保つ）
const wantSetImage = implementer.want.setImage.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, coupleId, userId, r2Sign } = context;

  const current = await fetchMine(db, coupleId, userId, input.id);
  if (!current) throw errors.NOT_FOUND();

  let newKey: string | null = null;
  if (input.imageId !== null) {
    newKey = await verifyUploadedImage(bucket, wantImageKeyFor(coupleId, input.imageId, "jpg"), () =>
      errors.INVALID_INPUT(),
    );
  }

  // D1 → R2 の順（逆だと「行は残るのに画像が消える」が見える）
  try {
    const updated = await db
      .prepare(
        `UPDATE wants SET image_key = ?1
          WHERE id = ?2 AND couple_id = ?3 AND owner_id = ?4 AND deleted_at IS NULL
         RETURNING id AS id`,
      )
      .bind(newKey, input.id, coupleId, userId)
      .first<{ id: string }>();
    if (!updated) throw errors.NOT_FOUND();
  } catch (error) {
    if (isConstraintViolation(error)) throw errors.INVALID_INPUT();
    throw error;
  }

  if (current.image_key && current.image_key !== newKey) await deleteQuietly(bucket, current.image_key);

  const row = await fetchMine(db, coupleId, userId, input.id);
  if (!row) throw errors.NOT_FOUND();
  return toWant(row, userId, r2Sign);
});

// toggle でなく値を渡す（冪等）。本人のみ
const wantSetObtained = implementer.want.setObtained
  .use(writeProcedure)
  .handler(async ({ context, input, errors }) => {
    const { db, coupleId, userId, r2Sign } = context;

    const updated = await db
      .prepare(
        `UPDATE wants
            SET obtained_at = CASE WHEN ?1 THEN COALESCE(obtained_at, ?2) ELSE NULL END
          WHERE id = ?3 AND couple_id = ?4 AND owner_id = ?5 AND deleted_at IS NULL
         RETURNING id AS id`,
      )
      .bind(input.obtained ? 1 : 0, nowSeconds(), input.id, coupleId, userId)
      .first<{ id: string }>();
    if (!updated) throw errors.NOT_FOUND();

    const row = await fetchMine(db, coupleId, userId, input.id);
    if (!row) throw errors.NOT_FOUND();
    return toWant(row, userId, r2Sign);
  });

// 論理削除 + R2 は物理削除。本人のみ。行の image_key は NULL に戻す（UNIQUE の空きを塞がない）
const wantDelete = implementer.want.delete.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, coupleId, userId } = context;

  // 消す前に鍵を読む（RETURNING は更新後の値しか返さない）。間に消されても UPDATE 0 件で NOT_FOUND になるだけ
  const current = await fetchMine(db, coupleId, userId, input.id);
  if (!current) throw errors.NOT_FOUND();

  const row = await db
    .prepare(
      `UPDATE wants SET deleted_at = ?1, image_key = NULL
        WHERE id = ?2 AND couple_id = ?3 AND owner_id = ?4 AND deleted_at IS NULL
       RETURNING id AS id`,
    )
    .bind(nowSeconds(), input.id, coupleId, userId)
    .first<{ id: string }>();
  if (!row) throw errors.NOT_FOUND();

  if (current.image_key) await deleteQuietly(bucket, current.image_key);
  return { id: row.id };
});

// imageId と鍵はサーバだけが組み立てる。手で付ける経路は JPEG のみ
const wantUploadUrl = implementer.want.uploadUrl.use(writeProcedure).handler(async ({ context, input }) => {
  const { coupleId, r2Sign } = context;
  const imageId = generateImageId();
  const key = wantImageKeyFor(coupleId, imageId, "jpg");
  const url = await createPutUrl(r2Sign, key, input.contentType);
  return { imageId, url };
});

export const wantProcedures = {
  list: wantList,
  create: wantCreate,
  update: wantUpdate,
  setImage: wantSetImage,
  setObtained: wantSetObtained,
  delete: wantDelete,
  uploadUrl: wantUploadUrl,
};

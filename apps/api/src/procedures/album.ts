import { PHOTO_LIST_DEFAULT_LIMIT, TIMELINE_PREVIEW_COUNT, type Photo, type PhotoRef } from "@futary/contract";
import { formatJstDateCompact } from "@futary/date";
import { implementer } from "../implementer";
import {
  albumImageKeyFor,
  createDownloadUrl,
  createGetUrl,
  createPutUrl,
  imageIdOfKey,
  MAX_IMAGE_BYTES,
  type R2SignConfig,
} from "../lib/r2-signed-url";
import { exceedsFreeQuota, isLocked, loadPlanState, unlockedPhotos, type UnlockedPhoto } from "../lib/plan";
import { generateImageId } from "../lib/ulid";
import { isConstraintViolation } from "./couple";
import { readProcedure, writeProcedure } from "./base";

// 1 アルバム 500 枚・1 ペア 1,000 件（未削除。500 × 1,000 = 50 万枚。055）。超えたら LIMIT_REACHED
const MAX_ALBUMS_PER_COUPLE = 1_000;
const MAX_PHOTOS_PER_ALBUM = 500;

// 契約の z.literal と同じ値。署名付き PUT URL は Content-Type を強制できないので、実体を確かめるときに見る
const UPLOAD_CONTENT_TYPE = "image/jpeg";

// D1 の「1 文あたりの束縛パラメータ」の上限は 100（developers.cloudflare.com/d1/platform/limits/）。
// ローカルの miniflare は 32766 まで通すのでテストでは見えない。IN 句の id はこの数ずつの DELETE に
// 分けて 1 本の batch() に入れる（上限は文ごと）。1 文のパラメータは id の数 + 2（album_id・couple_id）
export const D1_MAX_BOUND_PARAMETERS = 100;
export const REMOVE_PHOTOS_CHUNK_SIZE = 50;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// --- 行の形 ---------------------------------------------

interface AlbumRow {
  id: string;
  title: string;
  note: string;
  start_date: string | null;
  end_date: string | null;
  cover_photo_id: string | null;
  created_at: number;
  photo_count: number;
  cover_id: string | null;
  cover_key: string | null;
  cover_width: number | null;
  cover_height: number | null;
}

// 鍵の文脈。locked のときだけ持つ（null なら鍵は無い）。unlocked は鍵でない写真（先頭 30 枚）。
// 判定は lib/plan.ts の 1 箇所で、ここは「この中に無い = 鍵」と読むだけ（047）
interface LockContext {
  unlocked: UnlockedPhoto[];
  unlockedIds: Set<string>;
}

async function loadLock(db: D1Database, coupleId: string): Promise<LockContext | null> {
  const state = await loadPlanState(db, coupleId, nowSeconds());
  if (!isLocked(state)) return null;
  const unlocked = await unlockedPhotos(db, coupleId);
  return { unlocked, unlockedIds: new Set(unlocked.map((p) => p.id)) };
}

interface AlbumPhotoRow {
  id: string;
  key: string;
  width: number;
  height: number;
  caption: string;
  taken_at: number;
}

interface TimelinePhotoRow {
  post_id: string;
  position: number;
  key: string;
  width: number;
  height: number;
  body: string;
  created_at: number;
}

// アルバム 1 行を、枚数とカバーの解決まで含めて 1 文で引く。
// カバーに FK は張らず、読むときに倒す: cover_photo_id の写真があればそれ、無ければいちばん新しい写真。
// `(p2.id = a.cover_photo_id) DESC` は cover_photo_id が NULL なら全行が同順位で taken_at DESC に落ち、
// 指定があれば一致する 1 行だけが先頭に来る。写真が 0 枚なら cover_* が NULL
const ALBUM_SELECT =
  `SELECT a.id AS id, a.title AS title, a.note AS note, a.start_date AS start_date, a.end_date AS end_date,
          a.cover_photo_id AS cover_photo_id, a.created_at AS created_at,
          (SELECT COUNT(*) FROM album_photos p WHERE p.album_id = a.id) AS photo_count,
          c.id AS cover_id, c.key AS cover_key, c.width AS cover_width, c.height AS cover_height
     FROM albums a
     LEFT JOIN album_photos c ON c.id = (
       SELECT p2.id FROM album_photos p2 WHERE p2.album_id = a.id
        ORDER BY (p2.id = a.cover_photo_id) DESC, p2.taken_at DESC, p2.id DESC
        LIMIT 1)`;

// カバーが鍵の写真なら、このアルバムの鍵でない中でいちばん新しいものに倒す。無ければ null。
// photoCount は鍵を含む数のまま（047）
function resolveCover(row: AlbumRow, lock: LockContext | null): { key: string; width: number; height: number } | null {
  if (row.cover_key === null || row.cover_width === null || row.cover_height === null) return null;
  if (lock === null || (row.cover_id !== null && lock.unlockedIds.has(row.cover_id))) {
    return { key: row.cover_key, width: row.cover_width, height: row.cover_height };
  }
  let newest: UnlockedPhoto | null = null;
  for (const p of lock.unlocked) {
    if (p.album_id !== row.id) continue;
    if (newest === null || p.taken_at > newest.taken_at || (p.taken_at === newest.taken_at && p.id > newest.id)) newest = p;
  }
  return newest ? { key: newest.key, width: newest.width, height: newest.height } : null;
}

async function toAlbum(row: AlbumRow, r2Sign: R2SignConfig, lock: LockContext | null) {
  const cover = resolveCover(row, lock);
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    startDate: row.start_date,
    endDate: row.end_date,
    photoCount: row.photo_count,
    cover: cover ? { url: await createGetUrl(r2Sign, cover.key), width: cover.width, height: cover.height } : null,
    createdAt: row.created_at,
  };
}

// 自ペアの未削除のアルバムを 1 件。他ペア・削除済み・存在しないは区別せず null（存在を教えない）
async function fetchAlbum(db: D1Database, coupleId: string, id: string): Promise<AlbumRow | null> {
  return db
    .prepare(`${ALBUM_SELECT} WHERE a.id = ?1 AND a.couple_id = ?2 AND a.deleted_at IS NULL`)
    .bind(id, coupleId)
    .first<AlbumRow>();
}

async function fetchAlbumOrThrow(
  db: D1Database,
  coupleId: string,
  id: string,
  notFound: () => Error,
): Promise<AlbumRow> {
  const row = await fetchAlbum(db, coupleId, id);
  if (!row) throw notFound();
  return row;
}

// 鍵の写真は url が null・caption が空（URL を出さないことで「見られない」を作る。047）
async function toAlbumPhoto(row: AlbumPhotoRow, r2Sign: R2SignConfig, lock: LockContext | null): Promise<Photo> {
  const locked = lock !== null && !lock.unlockedIds.has(row.id);
  return {
    ref: { kind: "album", photoId: row.id },
    url: locked ? null : await createGetUrl(r2Sign, row.key),
    width: row.width,
    height: row.height,
    takenAt: row.taken_at,
    caption: locked ? "" : row.caption,
    locked,
  };
}

async function toTimelinePhoto(row: TimelinePhotoRow, r2Sign: R2SignConfig): Promise<Photo> {
  return {
    ref: { kind: "post", postId: row.post_id, position: row.position },
    url: await createGetUrl(r2Sign, row.key),
    locked: false,
    width: row.width,
    height: row.height,
    takenAt: row.created_at,
    caption: row.body,
  };
}

// --- R2 ---------------------------------------------

// R2 のエラーメッセージは画像キーを含みうるので、詰め替えて投げる（withErrorId がログに出す。
// security-requirements.md 8節）
async function headOrThrow(bucket: R2Bucket, key: string): Promise<R2Object | null> {
  try {
    return await bucket.head(key);
  } catch {
    throw new Error("R2からの画像実体確認に失敗しました");
  }
}

async function deleteQuietly(bucket: R2Bucket, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await bucket.delete(keys);
  } catch {
    // 掃除の失敗で利用者の操作を失敗させない。行は消えているので孤児として残る
    // （architecture.md 6節の回収手順の対象）。キーはログに出さない
  }
}

// 実体を全部確かめてから鍵を返す（1 枚でも無ければ INVALID_INPUT。部分的に入れない）。
// 型やサイズが違う実体は消す（残すと、同じ imageId を二度と使えない孤児になる）
async function verifyUploadedImages(
  bucket: R2Bucket,
  coupleId: string,
  imageIds: readonly string[],
  invalidInput: () => Error,
): Promise<string[]> {
  const keys: string[] = [];
  for (const imageId of imageIds) {
    const key = albumImageKeyFor(coupleId, imageId);
    const head = await headOrThrow(bucket, key);
    if (!head) throw invalidInput();
    if (head.size > MAX_IMAGE_BYTES || head.httpMetadata?.contentType !== UPLOAD_CONTENT_TYPE) {
      await deleteQuietly(bucket, [key]);
      throw invalidInput();
    }
    keys.push(key);
  }
  return keys;
}

// --- カーソル ---------------------------------------------

// 不透明な文字列。タイムラインは (created_at, post_id, position)、アルバムは (taken_at, id) の複合で、
// 同秒の投稿・写真がページ境界をまたいでも重複・欠落しない
interface TimelineCursor {
  createdAt: number;
  postId: string;
  position: number;
}
interface AlbumCursor {
  takenAt: number;
  id: string;
}

function encodeCursor(cursor: TimelineCursor | AlbumCursor): string {
  return btoa(JSON.stringify(cursor));
}

function decodeTimelineCursor(value: string): TimelineCursor {
  const parsed: unknown = JSON.parse(atob(value));
  const c = parsed as Partial<TimelineCursor> | null;
  if (!c || typeof c.createdAt !== "number" || typeof c.postId !== "string" || typeof c.position !== "number") {
    throw new Error("cursor の形式が不正です");
  }
  return { createdAt: c.createdAt, postId: c.postId, position: c.position };
}

function decodeAlbumCursor(value: string): AlbumCursor {
  const parsed: unknown = JSON.parse(atob(value));
  const c = parsed as Partial<AlbumCursor> | null;
  if (!c || typeof c.takenAt !== "number" || typeof c.id !== "string") {
    throw new Error("cursor の形式が不正です");
  }
  return { takenAt: c.takenAt, id: c.id };
}

// タイムライン（仮想）: 未削除の投稿の写真を新しい順（posts.created_at DESC, posts.id DESC,
// position ASC）。`posts.deleted_at IS NULL` を必ず含める（architecture.md 4節）
const TIMELINE_SELECT = `SELECT post_images.post_id AS post_id, post_images.position AS position, post_images.key AS key,
        post_images.width AS width, post_images.height AS height, posts.body AS body, posts.created_at AS created_at
   FROM post_images JOIN posts ON posts.id = post_images.post_id
  WHERE posts.couple_id = ?1 AND posts.deleted_at IS NULL`;
const TIMELINE_ORDER = `ORDER BY posts.created_at DESC, posts.id DESC, post_images.position ASC`;

async function fetchTimelinePage(
  db: D1Database,
  coupleId: string,
  cursor: TimelineCursor | null,
  limit: number,
): Promise<TimelinePhotoRow[]> {
  // 次ページの有無を 1 回のクエリで判定するため limit + 1 件取る
  const stmt = cursor
    ? db
        .prepare(
          `${TIMELINE_SELECT}
              AND (posts.created_at < ?2
                   OR (posts.created_at = ?2 AND posts.id < ?3)
                   OR (posts.created_at = ?2 AND posts.id = ?3 AND post_images.position > ?4))
            ${TIMELINE_ORDER} LIMIT ?5`,
        )
        .bind(coupleId, cursor.createdAt, cursor.postId, cursor.position, limit + 1)
    : db.prepare(`${TIMELINE_SELECT} ${TIMELINE_ORDER} LIMIT ?2`).bind(coupleId, limit + 1);
  const { results } = await stmt.all<TimelinePhotoRow>();
  return results;
}

// アルバムの写真: 古い順（taken_at ASC, id ASC。旅行の 1 日目が先に来る）
const ALBUM_PHOTO_SELECT = `SELECT id AS id, key AS key, width AS width, height AS height, caption AS caption, taken_at AS taken_at
   FROM album_photos WHERE album_id = ?1`;
const ALBUM_PHOTO_ORDER = `ORDER BY taken_at ASC, id ASC`;

async function fetchAlbumPhotoPage(
  db: D1Database,
  albumId: string,
  cursor: AlbumCursor | null,
  limit: number,
): Promise<AlbumPhotoRow[]> {
  const stmt = cursor
    ? db
        .prepare(
          `${ALBUM_PHOTO_SELECT} AND (taken_at > ?2 OR (taken_at = ?2 AND id > ?3)) ${ALBUM_PHOTO_ORDER} LIMIT ?4`,
        )
        .bind(albumId, cursor.takenAt, cursor.id, limit + 1)
    : db.prepare(`${ALBUM_PHOTO_SELECT} ${ALBUM_PHOTO_ORDER} LIMIT ?2`).bind(albumId, limit + 1);
  const { results } = await stmt.all<AlbumPhotoRow>();
  return results;
}

// --- album.* ---------------------------------------------

// 未削除・新しい順。ページング無し（1,000 件上限）。署名は previews 4 枚 + カバー最大 1,000 枚で、
// 手元の HMAC 計算なので R2 への往復は無い（1,000 件でも応答は 1MB 未満。055）
const albumList = implementer.album.list.use(readProcedure).handler(async ({ context }) => {
  const { db, coupleId, r2Sign } = context;

  const [countRow, previewRows, albumRows, lock] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM post_images JOIN posts ON posts.id = post_images.post_id
          WHERE posts.couple_id = ?1 AND posts.deleted_at IS NULL`,
      )
      .bind(coupleId)
      .first<{ count: number }>(),
    db.prepare(`${TIMELINE_SELECT} ${TIMELINE_ORDER} LIMIT ?2`).bind(coupleId, TIMELINE_PREVIEW_COUNT).all<TimelinePhotoRow>(),
    db
      .prepare(`${ALBUM_SELECT} WHERE a.couple_id = ?1 AND a.deleted_at IS NULL ORDER BY a.created_at DESC, a.id DESC`)
      .bind(coupleId)
      .all<AlbumRow>(),
    // 鍵の文脈は 1 度だけ引き、全アルバムのカバーの判定に使う（1,000 件でも 30 行）
    loadLock(db, coupleId),
  ]);

  const [previews, items] = await Promise.all([
    Promise.all(previewRows.results.map((row) => toTimelinePhoto(row, r2Sign))),
    Promise.all(albumRows.results.map((row) => toAlbum(row, r2Sign, lock))),
  ]);
  return { timeline: { photoCount: countRow?.count ?? 0, previews }, items };
});

const albumGet = implementer.album.get.use(readProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, r2Sign } = context;
  const row = await fetchAlbumOrThrow(db, coupleId, input.id, () => errors.NOT_FOUND());
  return toAlbum(row, r2Sign, await loadLock(db, coupleId));
});

// imageId と鍵はサーバだけが組み立てる
const albumUploadUrl = implementer.album.uploadUrl.use(writeProcedure).handler(async ({ context, input }) => {
  const { coupleId, r2Sign } = context;
  const imageId = generateImageId();
  const url = await createPutUrl(r2Sign, albumImageKeyFor(coupleId, imageId), input.contentType);
  return { imageId, url };
});

// 上限判定（COUNT）と挿入は 2 文に分かれる（同時に作ると上限を少し超えうるが受け入れる）。
// cover があれば実体を確かめてから、albums と album_photos を 1 本の batch() で書く（途中で割れない）
const albumCreate = implementer.album.create.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, coupleId, userId, r2Sign } = context;

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS count FROM albums WHERE couple_id = ?1 AND deleted_at IS NULL`)
    .bind(coupleId)
    .first<{ count: number }>();
  // free で無料枠を超えるなら PLAN_LIMIT（cover の 1 枚も入れない）。画面が「プランの話」と
  // 分かるよう LIMIT_REACHED より先に見る（045）
  if (input.cover && (await exceedsFreeQuota(db, coupleId, 1, nowSeconds()))) throw errors.PLAN_LIMIT();
  if ((countRow?.count ?? 0) >= MAX_ALBUMS_PER_COUPLE) throw errors.LIMIT_REACHED();

  // DB に 1 行も書く前に実体を確かめる（無ければ INVALID_INPUT でアルバムも作らない）
  let coverKey: string | null = null;
  if (input.cover) {
    const keys = await verifyUploadedImages(bucket, coupleId, [input.cover.imageId], () => errors.INVALID_INPUT());
    coverKey = keys[0] ?? null;
  }

  const id = crypto.randomUUID();
  const now = nowSeconds();
  const coverPhotoId = input.cover ? input.cover.imageId : null;
  const statements = [
    db
      .prepare(
        `INSERT INTO albums (id, couple_id, title, note, start_date, end_date, cover_photo_id, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
      )
      .bind(id, coupleId, input.title, input.note ?? "", input.startDate ?? null, input.endDate ?? null, coverPhotoId, userId, now),
  ];
  if (input.cover && coverKey) {
    statements.push(
      db
        .prepare(
          `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?6)`,
        )
        .bind(input.cover.imageId, id, coverKey, input.cover.width, input.cover.height, now),
    );
  }

  try {
    await db.batch(statements);
  } catch (error) {
    // album_photos.key の UNIQUE 違反 = 同じ imageId が既に別の行で使われている
    if (isConstraintViolation(error)) throw errors.INVALID_INPUT();
    throw error;
  }

  // 書いた直後の行が読めないのは到達不能（batch が成功している）。契約に NOT_FOUND は無い
  const row = await fetchAlbumOrThrow(db, coupleId, id, () => new Error("作成したアルバムを読み直せませんでした"));
  return toAlbum(row, r2Sign, await loadLock(db, coupleId));
});

// 渡されなかった項目は変えない。終了日と開始日の順序は既存の値と合わせて確かめる。
// coverPhotoId はアルバム内の写真でなければ INVALID_INPUT（別のアルバム・別ペアの写真を区別しない）
const albumUpdate = implementer.album.update.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, r2Sign } = context;

  const current = await fetchAlbumOrThrow(db, coupleId, input.id, () => errors.NOT_FOUND());

  const startDate = input.startDate === undefined ? current.start_date : input.startDate;
  let endDate = input.endDate === undefined ? current.end_date : input.endDate;
  // 終了日は開始日が無いと持てない。開始日を外したら終了日も外れ、開始日が無い・開始日より前の
  // 終了日を明示したら INVALID_INPUT
  if (input.endDate === undefined && startDate === null) endDate = null;
  if (endDate !== null && (startDate === null || endDate < startDate)) throw errors.INVALID_INPUT();

  let coverPhotoId = current.cover_photo_id;
  if (input.coverPhotoId !== undefined) {
    if (input.coverPhotoId !== null) {
      const inAlbum = await db
        .prepare(`SELECT 1 AS one FROM album_photos WHERE id = ?1 AND album_id = ?2`)
        .bind(input.coverPhotoId, input.id)
        .first<{ one: number }>();
      if (!inAlbum) throw errors.INVALID_INPUT();
    }
    coverPhotoId = input.coverPhotoId;
  }

  const updated = await db
    .prepare(
      `UPDATE albums SET title = ?1, note = ?2, start_date = ?3, end_date = ?4, cover_photo_id = ?5, updated_at = ?6
        WHERE id = ?7 AND couple_id = ?8 AND deleted_at IS NULL
       RETURNING id AS id`,
    )
    .bind(
      input.title ?? current.title,
      input.note ?? current.note,
      startDate,
      endDate,
      coverPhotoId,
      nowSeconds(),
      input.id,
      coupleId,
    )
    .first<{ id: string }>();
  if (!updated) throw errors.NOT_FOUND();

  const row = await fetchAlbumOrThrow(db, coupleId, input.id, () => errors.NOT_FOUND());
  return toAlbum(row, r2Sign, await loadLock(db, coupleId));
});

// 合計が 500 を超えるなら LIMIT_REACHED（1 枚も入れない）。全部の実体を確かめてから 1 本の batch() で書く。
// taken_at = 今。同秒の並びは id（ULID。uploadUrl の発行順）で決まる
const albumAddPhotos = implementer.album.addPhotos.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, coupleId, r2Sign } = context;

  const current = await fetchAlbumOrThrow(db, coupleId, input.id, () => errors.NOT_FOUND());
  // 無料枠を超えるなら PLAN_LIMIT（1 枚も入れない）。LIMIT_REACHED より先に見る
  if (await exceedsFreeQuota(db, coupleId, input.photos.length, nowSeconds())) throw errors.PLAN_LIMIT();
  if (current.photo_count + input.photos.length > MAX_PHOTOS_PER_ALBUM) throw errors.LIMIT_REACHED();

  const keys = await verifyUploadedImages(
    bucket,
    coupleId,
    input.photos.map((photo) => photo.imageId),
    () => errors.INVALID_INPUT(),
  );

  const now = nowSeconds();
  try {
    await db.batch(
      input.photos.map((photo, i) =>
        db
          .prepare(
            `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
          )
          .bind(photo.imageId, input.id, keys[i], photo.width, photo.height, photo.caption ?? "", now),
      ),
    );
  } catch (error) {
    if (isConstraintViolation(error)) throw errors.INVALID_INPUT();
    throw error;
  }

  const row = await fetchAlbumOrThrow(db, coupleId, input.id, () => errors.NOT_FOUND());
  return toAlbum(row, r2Sign, await loadLock(db, coupleId));
});

// 説明文だけ変える。WHERE に「このペアの未削除のアルバムの写真」を EXISTS で含めた 1 文
const albumUpdatePhoto = implementer.album.updatePhoto
  .use(writeProcedure)
  .handler(async ({ context, input, errors }) => {
    const { db, coupleId, r2Sign } = context;

    // 鍵の写真は説明文も書けない（NOT_FOUND。047）
    const lock = await loadLock(db, coupleId);
    if (lock !== null && !lock.unlockedIds.has(input.photoId)) throw errors.NOT_FOUND();

    const row = await db
      .prepare(
        `UPDATE album_photos SET caption = ?1
          WHERE id = ?2 AND album_id = ?3
            AND EXISTS (SELECT 1 FROM albums WHERE id = ?3 AND couple_id = ?4 AND deleted_at IS NULL)
         RETURNING id AS id, key AS key, width AS width, height AS height, caption AS caption, taken_at AS taken_at`,
      )
      .bind(input.caption, input.photoId, input.id, coupleId)
      .first<AlbumPhotoRow>();
    if (!row) throw errors.NOT_FOUND();
    return toAlbumPhoto(row, r2Sign, lock);
  });

// 行を物理削除してから R2 を消す（D1 → R2。architecture.md 6節）。入っていない id は無視。
// カバーだった写真を外しても cover_photo_id は触らない（読む側が自動に倒す。T3）
const albumRemovePhotos = implementer.album.removePhotos
  .use(writeProcedure)
  .handler(async ({ context, input, errors }) => {
    const { db, bucket, coupleId, r2Sign } = context;

    await fetchAlbumOrThrow(db, coupleId, input.id, () => errors.NOT_FOUND());

    // D1 の束縛パラメータの上限（上の定数）に合わせて分け、1 本の batch() で消す（途中で割れない）
    const statements = [];
    for (let start = 0; start < input.photoIds.length; start += REMOVE_PHOTOS_CHUNK_SIZE) {
      const chunk = input.photoIds.slice(start, start + REMOVE_PHOTOS_CHUNK_SIZE);
      const placeholders = chunk.map((_, i) => `?${i + 3}`).join(", ");
      statements.push(
        db
          .prepare(
            `DELETE FROM album_photos
              WHERE album_id = ?1 AND id IN (${placeholders})
                AND EXISTS (SELECT 1 FROM albums WHERE id = ?1 AND couple_id = ?2 AND deleted_at IS NULL)
             RETURNING key AS key`,
          )
          .bind(input.id, coupleId, ...chunk),
      );
    }
    const batchResults = await db.batch<{ key?: string }>(statements);
    const keys = batchResults
      .flatMap((result) => result.results)
      .map((r) => r.key)
      .filter((key): key is string => typeof key === "string");

    await deleteQuietly(bucket, keys);

    const row = await fetchAlbumOrThrow(db, coupleId, input.id, () => errors.NOT_FOUND());
    return toAlbum(row, r2Sign, await loadLock(db, coupleId));
  });

// 論理削除 + album_photos は物理削除（同じ batch()）→ R2 を消す。
// DELETE にも couple_id の条件を EXISTS で含める（無いと他ペアの id で写真だけ消せる経路ができる）
const albumDelete = implementer.album.delete.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, coupleId } = context;

  const batchResults = await db.batch<{ id?: string; key?: string }>([
    db
      .prepare(
        `UPDATE albums SET deleted_at = ?1
          WHERE id = ?2 AND couple_id = ?3 AND deleted_at IS NULL
         RETURNING id AS id`,
      )
      .bind(nowSeconds(), input.id, coupleId),
    db
      .prepare(
        `DELETE FROM album_photos
          WHERE album_id = ?1
            AND EXISTS (SELECT 1 FROM albums WHERE id = ?1 AND couple_id = ?2)
         RETURNING key AS key`,
      )
      .bind(input.id, coupleId),
  ]);

  const row = batchResults[0]?.results[0];
  if (!row) throw errors.NOT_FOUND();

  const keys = (batchResults[1]?.results ?? [])
    .map((r) => r.key)
    .filter((key): key is string => typeof key === "string");
  await deleteQuietly(bucket, keys);

  return { id: input.id };
});

// --- photo.* ---------------------------------------------

// albumId 無し = タイムライン（全投稿写真・新しい順）。あればそのアルバム（古い順）
const photoList = implementer.photo.list.use(readProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, r2Sign } = context;
  const limit = input.limit ?? PHOTO_LIST_DEFAULT_LIMIT;

  if (input.albumId === undefined) {
    let cursor: TimelineCursor | null = null;
    if (input.cursor) {
      try {
        cursor = decodeTimelineCursor(input.cursor);
      } catch {
        throw errors.INVALID_INPUT();
      }
    }
    const results = await fetchTimelinePage(db, coupleId, cursor, limit);
    const hasMore = results.length > limit;
    const pageRows = hasMore ? results.slice(0, limit) : results;
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.created_at, postId: last.post_id, position: last.position }) : null;
    const items = await Promise.all(pageRows.map((row) => toTimelinePhoto(row, r2Sign)));
    return { items, nextCursor };
  }

  await fetchAlbumOrThrow(db, coupleId, input.albumId, () => errors.NOT_FOUND());
  let cursor: AlbumCursor | null = null;
  if (input.cursor) {
    try {
      cursor = decodeAlbumCursor(input.cursor);
    } catch {
      throw errors.INVALID_INPUT();
    }
  }
  const results = await fetchAlbumPhotoPage(db, input.albumId, cursor, limit);
  const hasMore = results.length > limit;
  const pageRows = hasMore ? results.slice(0, limit) : results;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ takenAt: last.taken_at, id: last.id }) : null;
  // locked のときだけ「鍵でない 30 枚」を引く（paid・猶予中は引かない）
  const lock = await loadLock(db, coupleId);
  const items = await Promise.all(pageRows.map((row) => toAlbumPhoto(row, r2Sign, lock)));
  return { items, nextCursor };
});

// ref から鍵と撮影日を引く。両方の kind とも自ペア・未削除に限る（他ペアの ref は NOT_FOUND）
async function resolvePhotoRef(
  db: D1Database,
  coupleId: string,
  ref: PhotoRef,
): Promise<{ key: string; takenAt: number } | null> {
  if (ref.kind === "post") {
    const row = await db
      .prepare(
        `SELECT post_images.key AS key, posts.created_at AS taken_at
           FROM post_images JOIN posts ON posts.id = post_images.post_id
          WHERE posts.couple_id = ?1 AND posts.deleted_at IS NULL AND post_images.post_id = ?2 AND post_images.position = ?3`,
      )
      .bind(coupleId, ref.postId, ref.position)
      .first<{ key: string; taken_at: number }>();
    return row ? { key: row.key, takenAt: row.taken_at } : null;
  }
  const row = await db
    .prepare(
      `SELECT album_photos.key AS key, album_photos.taken_at AS taken_at
         FROM album_photos JOIN albums ON albums.id = album_photos.album_id
        WHERE albums.couple_id = ?1 AND albums.deleted_at IS NULL AND album_photos.id = ?2`,
    )
    .bind(coupleId, ref.photoId)
    .first<{ key: string; taken_at: number }>();
  return row ? { key: row.key, takenAt: row.taken_at } : null;
}

// Content-Disposition: attachment 付きの署名付き GET URL（有効 5 分）。filename はサーバが
// 組み立てる（nisoine-YYYYMMDD-{imageId}.jpg。takenAt の JST。ASCII のみ）。ゲストも保存できる
const photoDownloadUrl = implementer.photo.downloadUrl.use(readProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, r2Sign } = context;
  const resolved = await resolvePhotoRef(db, coupleId, input);
  if (!resolved) throw errors.NOT_FOUND();
  // 鍵の写真は NOT_FOUND（存在を教えない）
  if (input.kind === "album") {
    const lock = await loadLock(db, coupleId);
    if (lock !== null && !lock.unlockedIds.has(input.photoId)) throw errors.NOT_FOUND();
  }
  const filename = `nisoine-${formatJstDateCompact(resolved.takenAt)}-${imageIdOfKey(resolved.key)}.jpg`;
  const url = await createDownloadUrl(r2Sign, resolved.key, filename);
  return { url, filename };
});

export const albumProcedures = {
  list: albumList,
  get: albumGet,
  uploadUrl: albumUploadUrl,
  create: albumCreate,
  update: albumUpdate,
  addPhotos: albumAddPhotos,
  updatePhoto: albumUpdatePhoto,
  removePhotos: albumRemovePhotos,
  delete: albumDelete,
};

export const photoProcedures = {
  list: photoList,
  downloadUrl: photoDownloadUrl,
};

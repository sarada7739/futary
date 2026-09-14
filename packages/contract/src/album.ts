import { oc } from "@orpc/contract";
import { z } from "zod";
import { IMAGE_ID_PATTERN, MAX_POST_IMAGES } from "./post";

// 041: アルバム。イベントごとに写真をまとめる（手で作る）+ 自動の「タイムライン」
// （写真付き投稿の写真。行を持たない仮想のアルバム。タスク定義0節 #4）。
// 機能名も 1 つ 1 つも「アルバム」（コードに group を使わない）

// wish・want と同じく、値の出どころが名前から分かるようにする
export const MAX_ALBUM_TITLE_LENGTH = 50;
export const MAX_ALBUM_NOTE_LENGTH = 200;
export const MAX_PHOTO_CAPTION_LENGTH = 200;
// 1 回の album.addPhotos で入れられる枚数（クライアントの 1 回の選択もこの数まで）
export const MAX_PHOTOS_PER_ADD = 20;
// 1 回の album.removePhotos で外せる枚数
export const MAX_PHOTOS_PER_REMOVE = 100;
// photo.list の 1 ページの上限（既定は PHOTO_LIST_DEFAULT_LIMIT）
export const PHOTO_LIST_MAX_LIMIT = 60;
export const PHOTO_LIST_DEFAULT_LIMIT = 30;
// album.list の previews（タイムラインの最新の写真）の枚数
export const TIMELINE_PREVIEW_COUNT = 4;
// 画面のルート `?id=` でタイムライン（仮想）を指す値。ULID は 26 文字の英数大文字なので
// 衝突しない（タスク定義3節）
export const TIMELINE_ALBUM_ID = "timeline";

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const titleSchema = z
  .string()
  .trim()
  .min(1, "アルバム名を入力してください")
  .max(MAX_ALBUM_TITLE_LENGTH, `アルバム名は${MAX_ALBUM_TITLE_LENGTH}文字以内で入力してください`);
const noteSchema = z
  .string()
  .trim()
  .max(MAX_ALBUM_NOTE_LENGTH, `メモは${MAX_ALBUM_NOTE_LENGTH}文字以内で入力してください`);
const captionSchema = z
  .string()
  .trim()
  .max(MAX_PHOTO_CAPTION_LENGTH, `説明は${MAX_PHOTO_CAPTION_LENGTH}文字以内で入力してください`);
const dateSchema = z.string().regex(YMD_PATTERN, "日付は YYYY-MM-DD の形式で入力してください");

// 写真の参照。タイムラインの写真は投稿 ID と位置、アルバムの写真は行の id。
// kind の両方を photo.downloadUrl が受ける（タスク定義2節）
export const photoRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("post"),
    postId: z.string(),
    position: z.number().int().min(0).max(MAX_POST_IMAGES - 1),
  }),
  z.object({ kind: z.literal("album"), photoId: z.string() }),
]);
export type PhotoRef = z.infer<typeof photoRefSchema>;

// url は署名付き GET URL（有効期限1時間。post.list と同じ）。呼ぶたびに発行し直す。
// タイムラインの写真は takenAt = posts.created_at、caption = 投稿本文
export const photoSchema = z.object({
  ref: photoRefSchema,
  url: z.string().url(),
  width: z.number(),
  height: z.number(),
  takenAt: z.number(),
  caption: z.string(),
});
export type Photo = z.infer<typeof photoSchema>;

export const albumCoverSchema = z.object({
  url: z.string().url(),
  width: z.number(),
  height: z.number(),
});

// created_by は返さない（wishes と同じ。両方が触れるので canEdit も無い）。
// cover は cover_photo_id の写真。無ければ（NULL・外された）アルバム内でいちばん新しい写真。
// 写真が 0 枚なら null
export const albumSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  photoCount: z.number().int().nonnegative(),
  cover: albumCoverSchema.nullable(),
  createdAt: z.number(),
});
export type Album = z.infer<typeof albumSchema>;

// album.list: 未削除・新しい順（created_at）。ページング無し（1 ペア 100 件上限）。
// timeline は仮想のアルバム（枚数 + 最新 4 枚）
export const albumListContract = oc
  .input(z.object({}))
  .output(
    z.object({
      timeline: z.object({ photoCount: z.number().int().nonnegative(), previews: z.array(photoSchema) }),
      items: z.array(albumSchema),
    }),
  )
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
  });

// 他ペア・削除済み・存在しない → NOT_FOUND（存在を教えない。want.* と同じ）
export const albumGetContract = oc
  .input(z.object({ id: z.string() }))
  .output(albumSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

// photo.list: albumId 無し = タイムライン（全投稿写真・新しい順）。あればそのアルバムの
// 写真（古い順）。post.list と同じカーソル方式（不透明な文字列）。limit 最大 60
export const photoListContract = oc
  .input(
    z.object({
      albumId: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(PHOTO_LIST_MAX_LIMIT).optional(),
    }),
  )
  .output(z.object({ items: z.array(photoSchema), nextCursor: z.string().nullable() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    // 他ペア・削除済み・存在しない albumId
    NOT_FOUND: {},
    // cursor が壊れている
    INVALID_INPUT: { status: 400 },
  });

// アルバムへの直接アップロード。post.uploadUrl と同じ形（署名付き PUT・5 分・ULID）。
// JPEG のみ（クライアントが圧縮する。ADR-007）
const UPLOAD_CONTENT_TYPE = "image/jpeg";

export const albumUploadUrlContract = oc
  .input(z.object({ contentType: z.literal(UPLOAD_CONTENT_TYPE) }))
  .output(z.object({ imageId: z.string(), url: z.string() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
  });

const uploadedPhotoSchema = z.object({
  imageId: z.string().regex(IMAGE_ID_PATTERN),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

// 終了日は開始日が無いと持てず、開始日以上（入力だけで判定できるので Zod の refine に
// 置く。conventions.md 5節）
function datesAreOrdered(value: { startDate?: string | null; endDate?: string | null }): boolean {
  if (value.endDate === undefined || value.endDate === null) return true;
  if (value.startDate === undefined || value.startDate === null) return false;
  return value.endDate >= value.startDate;
}
const DATE_ORDER_MESSAGE = "終了日は開始日以降の日付にしてください";

// album.create: cover があれば R2 に実体があることを確認してから最初の 1 枚として入れ、
// カバーにする（無ければ INVALID_INPUT でアルバムも作らない）。
// LIMIT_REACHED: 1 ペア 100 件（未削除）
export const albumCreateContract = oc
  .input(
    z
      .object({
        title: titleSchema,
        note: noteSchema.optional(),
        startDate: dateSchema.optional(),
        endDate: dateSchema.optional(),
        cover: uploadedPhotoSchema.optional(),
      })
      .refine(datesAreOrdered, { message: DATE_ORDER_MESSAGE }),
  )
  .output(albumSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    LIMIT_REACHED: { status: 409 },
    // 045: free で無料枠（FREE_ALBUM_PHOTO_LIMIT）を超える。1 枚も入れない。LIMIT_REACHED より先に見る
    PLAN_LIMIT: { status: 409 },
    // cover の imageId に対応する R2 の実体が無い・型やサイズが違う・既に別の行で使われている
    INVALID_INPUT: { status: 400 },
  });

// album.update: 渡されなかった項目は変えない。startDate / endDate は null で外す。
// coverPhotoId はアルバム内の写真でなければ INVALID_INPUT。null で自動。
// 終了日と開始日の順序は既存の値と合わせてサーバで確かめる（片方だけ渡されうるため
// 入力だけでは判定できない）
export const albumUpdateContract = oc
  .input(
    z
      .object({
        id: z.string(),
        title: titleSchema.optional(),
        note: noteSchema.optional(),
        startDate: dateSchema.nullable().optional(),
        endDate: dateSchema.nullable().optional(),
        coverPhotoId: z.string().nullable().optional(),
      })
      .refine(
        (value) => value.startDate === undefined || value.endDate === undefined || datesAreOrdered(value),
        { message: DATE_ORDER_MESSAGE },
      ),
  )
  .output(albumSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
    // coverPhotoId がアルバム内の写真でない・終了日が開始日より前・開始日無しで終了日だけ
    INVALID_INPUT: { status: 400 },
  });

// album.addPhotos: 全部の実体が R2 にあることを確認してから書く（1 枚でも無ければ
// INVALID_INPUT。部分的に入れない。post.create と同じ）。合計が 500 を超えるなら
// LIMIT_REACHED（1 枚も入れない）。taken_at = 今
export const albumAddPhotosContract = oc
  .input(
    z.object({
      id: z.string(),
      photos: z
        .array(uploadedPhotoSchema.extend({ caption: captionSchema.optional() }))
        .min(1)
        .max(MAX_PHOTOS_PER_ADD),
    }),
  )
  .output(albumSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
    LIMIT_REACHED: { status: 409 },
    // 045: free で無料枠を超える。1 枚も入れない。LIMIT_REACHED より先に見る
    PLAN_LIMIT: { status: 409 },
    INVALID_INPUT: { status: 400 },
  });

// 説明文だけ変える
export const albumUpdatePhotoContract = oc
  .input(z.object({ id: z.string(), photoId: z.string(), caption: captionSchema }))
  .output(photoSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

// 行を物理削除（D1 → R2）。入っていない id は無視
export const albumRemovePhotosContract = oc
  .input(z.object({ id: z.string(), photoIds: z.array(z.string()).min(1).max(MAX_PHOTOS_PER_REMOVE) }))
  .output(albumSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

// 論理削除 + album_photos は物理削除（同じ batch()）→ R2 を消す
export const albumDeleteContract = oc
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

// photo.downloadUrl: Content-Disposition: attachment 付きの署名付き GET URL（有効 5 分）。
// filename はサーバが組み立てる（futary-YYYYMMDD-{imageId}.jpg。ASCII のみ）。
// readProcedure（ゲストもデモの写真を保存できる。security-requirements.md 5節）
export const photoDownloadUrlContract = oc
  .input(photoRefSchema)
  .output(z.object({ url: z.string().url(), filename: z.string() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    // 他ペア・削除済み投稿・存在しない ref
    NOT_FOUND: {},
  });

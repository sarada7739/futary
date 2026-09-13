import { oc } from "@orpc/contract";
import { z } from "zod";
import { IMAGE_ID_PATTERN } from "./post";

// 040: ほしいもの。027「リスト」（wishes。ふたりで共有）とは別の機能で、
// 主語が本人・書けるのは本人だけ・URL と画像を持つ（タスク定義0節）。
// 「Wishlist」は既存の wishes と衝突するためコードには使わない（表は wants、契約は want.*）

// wish と同じく、値の出どころが名前から分かるようにする（MAX_WISH_TITLE_LENGTH のコメント参照）
export const MAX_WANT_TITLE_LENGTH = 100;
export const MAX_WANT_NOTE_LENGTH = 200;
export const MAX_WANT_URL_LENGTH = 2048;

// want.list の「誰のほしいものか」。ユーザーIDを引数に取らない（相手の ID を
// クライアントに持たせない。mood.list が2人分を分けて返すのと同じ考え方）
export const WANT_OWNER_SIDES = ["me", "partner"] as const;
export type WantOwnerSide = (typeof WANT_OWNER_SIDES)[number];

// http / https 以外の URL を通さない。入力で弾く（security-requirements.md 6節
// 「`http:` / `https:` 以外は取りに行かない（入力スキーマで弾く）」）だけでなく、
// 出力でも同じ検査をかける（Want.url はクライアントが Linking.openURL に渡す。
// `javascript:` 等が DB 経由で戻る経路を出力側でも閉じる。タスク定義4節・T11）
export function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

const titleSchema = z
  .string()
  .trim()
  .min(1, "題名を入力してください")
  .max(MAX_WANT_TITLE_LENGTH, `題名は${MAX_WANT_TITLE_LENGTH}文字以内で入力してください`);
const noteSchema = z
  .string()
  .trim()
  .max(MAX_WANT_NOTE_LENGTH, `メモは${MAX_WANT_NOTE_LENGTH}文字以内で入力してください`);
const urlInputSchema = z
  .string()
  .trim()
  .max(MAX_WANT_URL_LENGTH, `URL は${MAX_WANT_URL_LENGTH}文字以内で入力してください`)
  .refine(isHttpUrl, "http または https の URL を入力してください");
// 出力側。DB に入っている値もこの検査を通してから返す（上記）
const urlOutputSchema = z.string().max(MAX_WANT_URL_LENGTH).refine(isHttpUrl).nullable();

// image.url は署名付き GET URL（有効期限1時間。post.list と同じ）。呼ぶたびに発行し直す
export const wantImageSchema = z.object({
  url: z.string().url(),
});

// owner_id（ユーザーID）は返さない。isMine と ownerName で表す
// （タスク定義3節。createdByName と同じ考え方。architecture.md 5節）
export const wantSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: urlOutputSchema,
  note: z.string(),
  image: wantImageSchema.nullable(),
  isMine: z.boolean(),
  ownerName: z.string().nullable(),
  // 手に入れたら非NULL。手に入れても消えない（027 の doneAt と同じ）
  obtainedAt: z.number().nullable(),
  createdAt: z.number(),
});

export type Want = z.infer<typeof wantSchema>;

// want.list: ページングを持たない（1人100件の上限）。未削除のみ、新しい順。
// 手に入れたものは末尾にまとめる（027 と同じ）。
// ownerName は「そちら側の人」の表示名。partner 側で相手がまだ居ない（1人のペア）
// なら items は空・ownerName は null（画面はこれで「タブを出さない」を決める）
export const wantListContract = oc
  .input(z.object({ ownerSide: z.enum(WANT_OWNER_SIDES) }))
  .output(z.object({ items: z.array(wantSchema), ownerName: z.string().nullable() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
  });

// want.create: title と url の少なくとも一方が要る（入力だけで判定できるので
// Zod の refine に置く。conventions.md 5節）。url があり imageId が無ければ
// サーバが OGP から画像を試す。取れなくても 200（image が null なだけ）。
// imageId は post.create と同じく、want.uploadUrl が発行したものだけが有効。
// LIMIT_REACHED: 1人100件（未削除・手に入れた分を含む）
export const wantCreateContract = oc
  .input(
    z
      .object({
        title: titleSchema.optional(),
        url: urlInputSchema.optional(),
        note: noteSchema.optional(),
        imageId: z.string().regex(IMAGE_ID_PATTERN).optional(),
      })
      .refine((value) => value.title !== undefined || value.url !== undefined, {
        message: "題名か URL のどちらかを入力してください",
      }),
  )
  .output(wantSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    LIMIT_REACHED: { status: 409 },
    // imageId に対応する R2 の実体が無い・型やサイズが違う・既に別の行で使われている
    INVALID_INPUT: { status: 400 },
  });

// want.update: 本人のみ。URL を変えても画像は自動で取り直さない（取り直したければ
// 画像を外して付け直す。タスク定義4節）。url は null で外せる。
// 本人でない・存在しない・削除済みの id はすべて NOT_FOUND（存在を教えない）
export const wantUpdateContract = oc
  .input(z.object({ id: z.string(), title: titleSchema, url: urlInputSchema.nullable(), note: noteSchema }))
  .output(wantSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

// want.setImage: 手で付ける・外す。null で外す（R2 のオブジェクトも消す）。本人のみ
export const wantSetImageContract = oc
  .input(z.object({ id: z.string(), imageId: z.string().regex(IMAGE_ID_PATTERN).nullable() }))
  .output(wantSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
    INVALID_INPUT: { status: 400 },
  });

// toggle にしない。クライアントが目標の状態（obtained）を送る（027 3節・wish.setDone と同じ）
export const wantSetObtainedContract = oc
  .input(z.object({ id: z.string(), obtained: z.boolean() }))
  .output(wantSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

// 論理削除 + R2 のオブジェクトは物理削除。本人のみ
export const wantDeleteContract = oc
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

// 手で付ける経路は JPEG のみ（クライアントが圧縮する。ADR-007）。post.uploadUrl と同じ形
const UPLOAD_CONTENT_TYPE = "image/jpeg";

export const wantUploadUrlContract = oc
  .input(z.object({ contentType: z.literal(UPLOAD_CONTENT_TYPE) }))
  .output(z.object({ imageId: z.string(), url: z.string() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
  });

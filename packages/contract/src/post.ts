import { oc } from "@orpc/contract";
import { z } from "zod";
import { REACTION_KINDS } from "./reaction";

const MAX_BODY_LENGTH = 2000;

// 投稿ごとの「種別ごとの件数」と「自分が付けたかどうか」（タスク009・
// architecture.md 4節）。種類が heart の1種だけの間も配列にしておくことで、
// 種類が増えたときに postSchema 自体は変えずに済む
export const reactionSummarySchema = z.object({
  kind: z.enum(REACTION_KINDS),
  count: z.number().int().nonnegative(),
  reactedByMe: z.boolean(),
});

// imageId は post.uploadUrl/me.uploadImageUrl がサーバ側で生成する ULID
// （apps/api/src/lib/ulid.ts と同じ文字集合・長さ）。形式を絞ることで、
// 鍵の組み立て（couples/{coupleId}/posts/{imageId}.jpg・users/{userId}/
// profile/{imageId}.jpg）に混入しうる文字（パス区切り等）を構造的に閉じる
// （007 security-auditor 指摘: 検証が無いと理論上 imageId 経由でキーのパスを
// 操作できてしまう余地があった）。me.ts でも使うため export する
export const IMAGE_ID_PATTERN = /^[0-9A-HJKMNPQRSTVWXYZ]{26}$/;

// 031: 1投稿に画像を4枚まで（post_images。position順）。url は署名付き GET
// URL（有効期限1時間。architecture.md 6節）であり、post.list/post.create の
// たびに毎回新しく発行し直す
export const MAX_POST_IMAGES = 4;

export const postImageSchema = z.object({
  // 033・security-auditor指摘: 形式を絞る制約が無かった。この値はサーバが
  // 発行する署名付きURLしか入らない前提だが、将来出どころが増えたときの
  // 保険として、クライアントのImageコンポーネントへそのまま渡る値の形式を
  // ここで縛る（防御の深さ。出力スキーマのためoRPCがサーバ側でも検証する）
  url: z.string().url(),
  width: z.number(),
  height: z.number(),
});

export const postSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  // 008: 投稿カードに投稿者名・アバターを出すため追加。null許容の理由・
  // authorImageの出どころは architecture.md 5節参照
  authorName: z.string().nullable(),
  authorImage: z.string().nullable(),
  body: z.string(),
  // 031: imageUrl（単数）は契約から消した。残すと「1枚目だけ見ればいい」
  // 経路ができ、2枚目以降が静かに落ちるため。画像が無い投稿は空配列
  images: z.array(postImageSchema),
  createdAt: z.number(),
  // 009: 投稿ごとのリアクション集計。件数0のkindも含めてよい（UI側でcount>0のみ表示する）
  reactions: z.array(reactionSummarySchema),
});

export type Post = z.infer<typeof postSchema>;
export type PostImage = z.infer<typeof postImageSchema>;

// post.list: カーソルページング（1回20件固定）。cursor は created_at と id の
// 複合を不透明な文字列にエンコードしたもので、クライアントは中身を解釈しない
export const postListContract = oc
  .input(z.object({ cursor: z.string().optional() }))
  .output(z.object({ items: z.array(postSchema), nextCursor: z.string().nullable() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    // cursor が壊れている（改ざん・別バージョンのクライアント等）
    INVALID_INPUT: { status: 400 },
  });

// post.create: imageKey ではなく imageId を受け取る（architecture.md 5節）。
// 鍵は couples/{coupleId}/... という形をしており、これを受け取ることは
// coupleId を受け取ることと同じになるため、クライアントからは受け取らない。
// imageId は post.uploadUrl がサーバ側で生成して返したものだけが有効。
// 031: images は最大4件（枚数はZodで弾く。5件渡すとBAD_REQUEST。
// conventions.md 5節「入力だけで判定できることはZodに置く」）。空配列は
// 無いものとして扱う（undefinedと分けない）
const postCreateImageSchema = z.object({
  imageId: z.string().regex(IMAGE_ID_PATTERN),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const postCreateContract = oc
  .input(
    z.object({
      body: z.string().max(MAX_BODY_LENGTH, `本文は${MAX_BODY_LENGTH}文字以内で入力してください`),
      images: z.array(postCreateImageSchema).max(MAX_POST_IMAGES).optional(),
    }),
  )
  .output(postSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    // 本文（trim後）と images が両方空、または imageId のいずれかに対応する
    // R2の実体が無い、または同じ imageId が既に別の投稿に使われている場合
    INVALID_INPUT: { status: 400 },
  });

// post.delete: 論理削除。WHERE 句に couple_id を含めた1文で行うため、
// 他ペアの投稿IDを指定した場合と存在しないIDを指定した場合を区別せず NOT_FOUND にする
export const postDeleteContract = oc
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

const CONTENT_TYPE = "image/jpeg";

// post.uploadUrl: imageId（ULID）はサーバが生成する。鍵もサーバだけが組み立てる
// （architecture.md 5節・6節）。writeProcedure の上に載せるためデモ（未認証）からは呼べない
export const postUploadUrlContract = oc
  .input(z.object({ contentType: z.literal(CONTENT_TYPE) }))
  .output(z.object({ imageId: z.string(), url: z.string() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
  });

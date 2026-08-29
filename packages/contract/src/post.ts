import { oc } from "@orpc/contract";
import { z } from "zod";

const MAX_BODY_LENGTH = 2000;

export const postSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  body: z.string(),
  imageKey: z.string().nullable(),
  imageWidth: z.number().nullable(),
  imageHeight: z.number().nullable(),
  createdAt: z.number(),
});

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

// post.create: 画像は 007 でアップロードを実装するまでの間、
// imageKey/imageWidth/imageHeight を受け取って保存するだけ（architecture.md 6節）
export const postCreateContract = oc
  .input(
    z.object({
      body: z.string().max(MAX_BODY_LENGTH, `本文は${MAX_BODY_LENGTH}文字以内で入力してください`),
      imageKey: z.string().optional(),
      imageWidth: z.number().int().positive().optional(),
      imageHeight: z.number().int().positive().optional(),
    }),
  )
  .output(postSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
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

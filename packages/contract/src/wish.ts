import { oc } from "@orpc/contract";
import { z } from "zod";

const MAX_TITLE_LENGTH = 100;

// trim後に空、または100文字を超えると拒否する（タスク定義6節）
const titleSchema = z.string().trim().min(1, "タイトルを入力してください").max(MAX_TITLE_LENGTH);

// kindを持たない（027タスク定義1節）。createdByはレスポンスに含めない
// （event.createdByNameと違い、こちらはそもそも「誰が入れたか」を画面に出さない
// 設計のため名前解決もしない。architecture.md 5節）
export const wishSchema = z.object({
  id: z.string(),
  title: z.string(),
  // 達成したら非NULL。達成しても消えない（タスク定義2節）
  doneAt: z.number().nullable(),
  createdAt: z.number(),
});

export type Wish = z.infer<typeof wishSchema>;

// wish.list: ページングを持たない。1回で全件返す（タスク定義5節）。
// 未達成が先、達成済みが後。それぞれcreatedAtの新しい順（サーバ側で並べる）
export const wishListContract = oc.output(z.object({ items: z.array(wishSchema) })).errors({
  FORBIDDEN: {},
  NEEDS_ONBOARDING: { status: 409 },
});

// LIMIT_REACHED: 1ペア200件（未削除・達成済みを含む）の上限に達した（タスク定義5節）。
// 押す前に残り枠を出さない。当たってから伝える
export const wishCreateContract = oc.input(z.object({ title: titleSchema })).output(wishSchema).errors({
  FORBIDDEN: {},
  NEEDS_ONBOARDING: { status: 409 },
  INVALID_INPUT: { status: 400 },
  LIMIT_REACHED: { status: 409 },
});

// toggleにしない。クライアントが目標の状態（done）を送る。サーバ側は同じdoneを
// 何度送っても結果が変わらない（タスク定義3節。conventions.md「副作用を伴う
// ボタンは二重発火を防ぐ」のサーバ側の担保）
export const wishSetDoneContract = oc
  .input(z.object({ id: z.string(), done: z.boolean() }))
  .output(wishSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    // 他ペアのid・存在しないid・削除済みのidはすべてNOT_FOUND（存在を教えない）
    NOT_FOUND: {},
  });

// 論理削除。他ペアのidはNOT_FOUND（タスク定義8節）
export const wishDeleteContract = oc
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

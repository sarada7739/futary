import { oc } from "@orpc/contract";
import { z } from "zod";

// 長さの上限・下限はここではなくprocedures/wish.ts側でチェックし、
// INVALID_INPUTとして返す。oRPCは`.input()`のZodスキーマ自体のバリデーション
// 失敗を契約のエラー名にはマッピングせず、常にBAD_REQUESTとして返す
// （@orpc/serverのvalidateInputの実装で確認済み）。タスク定義がINVALID_INPUTを
// 明示しているため、trimだけをここで行い、長さの判定はハンドラに持たせる。
// 【security-auditor指摘】wish固有の値であることが名前から分かるようにする。
// event.tsにも同名（意味の違う値）のMAX_TITLE_LENGTHが private に存在しており、
// パッケージのトップレベルから同名でexportすると、将来event系のコードが
// うっかり@futary/contractからこちらをimportして上限が静かにすり替わりうる
export const MAX_WISH_TITLE_LENGTH = 100;
export const MAX_WISH_NOTE_LENGTH = 200;
const titleSchema = z.string().trim();
const noteSchema = z.string().trim();

// kindを持たない（027タスク定義1節）。createdByName（表示名。null許容。
// event.createdByNameと同じ形）を返すが、created_by（ユーザーID）は返さない
// （028。architecture.md 5節「出さないものを画面が使えないようにする」）。
// canEditは返さない。ペアの2人とも触れるため（021のplan持ち主と同じ仕組みに
// 見せない。028タスク定義2節）
export const wishSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string(),
  // 達成したら非NULL。達成しても消えない（タスク定義2節）
  doneAt: z.number().nullable(),
  createdAt: z.number(),
  createdByName: z.string().nullable(),
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
export const wishCreateContract = oc
  .input(z.object({ title: titleSchema, note: noteSchema.optional() }))
  .output(wishSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    INVALID_INPUT: { status: 400 },
    LIMIT_REACHED: { status: 409 },
  });

// 028: メモを足したことで「消して入れ直す」が成り立たなくなった（チェック状態・
// created_at・設定者が失われるため）。titleも編集できる（メモだけ編集できて
// 題名が編集できないのは説明できない。タスク定義4節）。渡されなかった項目は
// 変えない。created_byは更新しない（設定者は編集しても変わらない）
export const wishUpdateContract = oc
  .input(z.object({ id: z.string(), title: titleSchema.optional(), note: noteSchema.optional() }))
  .output(wishSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
    INVALID_INPUT: { status: 400 },
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

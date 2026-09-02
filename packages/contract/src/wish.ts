import { oc } from "@orpc/contract";
import { z } from "zod";

// 【訂正・2026-09-02。conventions.md 5節「入力の誤りを、どこで弾き、どの
// コードで返すか」】長さは1つの項目の中で完結する条件であり、契約のZodに
// 置く。BAD_REQUESTのままでよい（正しい画面なら送らない。送信前に止まって
// いるはずで、利用者に見せる文言はそこで見せる）。「INVALID_INPUTにしたい」
// を理由にZodで書ける条件を手続き側へ移さない、という規約に沿って戻した
// （028のタスク定義がINVALID_INPUTと書いていたのが原因。Aの誤りとして
// 訂正済み）。
// 【security-auditor指摘・維持】wish固有の値であることが名前から分かる
// ようにする。event.tsにも同名（意味の違う値）のMAX_TITLE_LENGTHが
// private に存在しており、パッケージのトップレベルから同名でexportすると、
// 将来event系のコードがうっかり@futary/contractからこちらをimportして
// 上限が静かにすり替わりうる
export const MAX_WISH_TITLE_LENGTH = 100;
export const MAX_WISH_NOTE_LENGTH = 200;
// trim後に空、または100文字を超えると拒否する（タスク定義6節）
const titleSchema = z.string().trim().min(1, "タイトルを入力してください").max(MAX_WISH_TITLE_LENGTH);
// メモは任意で空でよい（titleと違いmin(1)は無い）。200文字（trim後）まで
const noteSchema = z.string().trim().max(MAX_WISH_NOTE_LENGTH, `メモは${MAX_WISH_NOTE_LENGTH}文字以内で入力してください`);

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
// 押す前に残り枠を出さない。当たってから伝える。
// titleSchema/noteSchemaの長さ違反はBAD_REQUEST（Zodのバリデーション失敗。
// 手続き側でINVALID_INPUTを投げないため.errors()にも宣言しない。
// conventions.md 5節「投げないコードを宣言しない」）
export const wishCreateContract = oc
  .input(z.object({ title: titleSchema, note: noteSchema.optional() }))
  .output(wishSchema)
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
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

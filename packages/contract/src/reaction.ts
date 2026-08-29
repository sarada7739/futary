import { oc } from "@orpc/contract";
import { z } from "zod";

// まず heart の1種だけで実装する（state.md 論点L4）。kind を持つスキーマの
// ため、種類を増やす判断はレビュー時に R が行う。B は勝手に増やさない
export const REACTION_KINDS = ["heart"] as const;
const reactionKindSchema = z.enum(REACTION_KINDS);

// reaction.toggle: 既にあれば削除、無ければ追加する（writeProcedure の上に載る）。
// 引数は postId のみで coupleId を受け取らない（architecture.md 5節）。
// 対象投稿が自ペアのものであることは、実装側で couple_id を WHERE 句に
// 含めた1文で保証する（他ペアの投稿IDを指定すると NOT_FOUND）
export const reactionToggleContract = oc
  .input(z.object({ postId: z.string(), kind: reactionKindSchema }))
  .output(z.object({ postId: z.string(), kind: reactionKindSchema, reacted: z.boolean() }))
  .errors({
    FORBIDDEN: {},
    NEEDS_ONBOARDING: { status: 409 },
    NOT_FOUND: {},
  });

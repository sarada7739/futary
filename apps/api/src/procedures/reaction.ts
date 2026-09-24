import { implementer } from "../implementer";
import { writeProcedure } from "./base";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// 区別したいのは (post_id, user_id, kind) の UNIQUE 違反（同時リクエストのレース）だけ。
// 制約違反全般を「付いている」扱いにすると、書いていないのに成功として返る
function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Error && /unique constraint failed/i.test(error.message);
}

// 既にあれば消し、無ければ足す。reactions は couple_id を持たないので、対象が自ペアの投稿であることを
// posts への EXISTS で同じ 1 文の中で確かめる（SELECT してから書く 2 段階にしない。architecture.md 4節）
const reactionToggle = implementer.reaction.toggle
  .use(writeProcedure)
  .handler(async ({ context, input, errors }) => {
    const { db, coupleId, userId } = context;

    // まず削除を試みる。削除できた = 既に付けていた
    const deleted = await db
      .prepare(
        `DELETE FROM reactions
          WHERE post_id = ?1 AND user_id = ?2 AND kind = ?3
            AND EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND couple_id = ?4 AND deleted_at IS NULL)
         RETURNING post_id`,
      )
      .bind(input.postId, userId, input.kind, coupleId)
      .first<{ post_id: string }>();

    if (deleted) {
      return { postId: input.postId, kind: input.kind, reacted: false };
    }

    // 削除 0 件では「付けていなかった」か「自ペアの投稿でない」か区別できない。INSERT にも同じ条件を
    // 含め、挿入できたかで決める（自ペアに無ければ 0 件で NOT_FOUND）
    let inserted: { post_id: string } | null;
    try {
      inserted = await db
        .prepare(
          `INSERT INTO reactions (post_id, user_id, kind, created_at)
           SELECT ?1, ?2, ?3, ?4
            WHERE EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND couple_id = ?5 AND deleted_at IS NULL)
           RETURNING post_id`,
        )
        .bind(input.postId, userId, input.kind, nowSeconds(), coupleId)
        .first<{ post_id: string }>();
    } catch (error) {
      // 同時に飛んだ別のリクエストが先に挿入した。今は付いている状態なので reacted: true
      if (isUniqueConstraintViolation(error)) {
        return { postId: input.postId, kind: input.kind, reacted: true };
      }
      throw error;
    }

    if (!inserted) throw errors.NOT_FOUND();
    return { postId: input.postId, kind: input.kind, reacted: true };
  });

export const reactionProcedures = {
  toggle: reactionToggle,
};

import { implementer } from "../implementer";
import { writeProcedure } from "./base";

// created_at用のUnix秒。JSTの暦日計算ではないためpackages/date対象外
function nowSeconds(): number {
  // eslint-disable-next-line no-restricted-syntax
  return Math.floor(Date.now() / 1000);
}

// couple.ts の isConstraintViolation は制約違反全般（UNIQUE/NOT NULL/FK）に
// 一致するが、ここで区別したいのは「(post_id, user_id, kind) の UNIQUE 違反 =
// 同時リクエストのレース」だけである。それ以外の制約違反まで「付いている」
// 扱いにすると、書き込みが起きていないのに成功として返ってしまう
// （M2まとめ監査 Low指摘）
function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Error && /unique constraint failed/i.test(error.message);
}

// reaction.toggle: 既にあれば削除、無ければ追加する（タスク009）。
// postId は couple_id = ctx.coupleId を WHERE 句に含めた1文で扱い、
// 006 の post.delete と同じ形で他ペアの投稿への到達を防ぐ。
// reactions テーブル自体は couple_id を持たないため、対象投稿が自ペアの
// ものであることは posts への EXISTS で確認する（SELECT してから
// 判断して書く、という2段階にはしない。architecture.md 4節）
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

    // 削除が0件の時点では「付けていなかった」のか「対象投稿が自ペアに無い」のか
    // 区別できない。INSERT 側にも同じ couple_id 条件を含め、挿入できたかどうかで
    // 判定する（対象が自ペアに無ければ挿入も0件になり NOT_FOUND を返す）
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
      // (post_id, user_id, kind) の UNIQUE 違反 = 同時に飛んだ別リクエストが
      // 先に挿入を終えていたレース。この時点では「付いている」状態なので
      // reacted: true を返す（呼び出し元から見て操作自体は成功している）
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

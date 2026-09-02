import { implementer } from "../implementer";
import { generateImageId } from "../lib/ulid";
import { createPutUrl, MAX_IMAGE_BYTES, resolveUserImage, userImageKeyFor } from "../lib/r2-signed-url";
import { isSessionFresh } from "../lib/reauth";
import { authedProcedure } from "./base";

// postUploadUrlContract（apps/api/src/procedures/upload.ts）と同じ値
const UPLOAD_CONTENT_TYPE = "image/jpeg";

// authedProcedure の上に載せる（ペア未所属でも自分のプロフィールは
// 設定できる。couple.create/invite.acceptと同じ理由。019タスク定義）
// 「他人のプロフィールを変更できない」は入力に対象ユーザーIDを持たせない
// ことで構造的に保証する（常にcontext.user.idだけをWHEREに使う。
// post.createの投稿者と同じ形）。到達不能な経路のため、これを試みて
// 失敗することを確認するテストは書かない（L35と同じ判断）
const meUpdate = implementer.me.update.use(authedProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, r2Sign, user } = context;

  let newImageKey: string | null = null;
  if (input.imageId) {
    const key = userImageKeyFor(user.id, input.imageId);
    // image列が非NULLなら実体がある、という不変条件を保つため書く前に確認する
    // （post.createと同じ理由。architecture.md 6節）
    const head = await bucket.head(key);
    if (!head) throw errors.INVALID_INPUT();
    if (head.size > MAX_IMAGE_BYTES || head.httpMetadata?.contentType !== UPLOAD_CONTENT_TYPE) {
      await bucket.delete(key);
      throw errors.INVALID_INPUT();
    }
    newImageKey = key;
  }

  // imageIdを省略したとき既存の画像を変更しない、をDB側のCOALESCEで表す。
  // context.user.image（セッションにキャッシュされた値）を読んで書き戻す形だと、
  // セッション側が古いままDBだけ更新されるケースとズレる可能性がある
  const row = await db
    .prepare("UPDATE user SET name = ?1, image = COALESCE(?2, image) WHERE id = ?3 RETURNING image AS image")
    .bind(input.name, newImageKey, user.id)
    .first<{ image: string | null }>();

  return { id: user.id, name: input.name, email: user.email, image: await resolveUserImage(r2Sign, row?.image ?? null) };
});

// me.uploadImageUrl: post.uploadUrlと同じ形。imageIdはサーバが生成し、
// 鍵（users/{userId}/...）もサーバだけが組み立てる（architecture.md 5節・6節）
const meUploadImageUrl = implementer.me.uploadImageUrl
  .use(authedProcedure)
  .handler(async ({ context, input }) => {
    const { user, r2Sign } = context;
    const imageId = generateImageId();
    const key = userImageKeyFor(user.id, imageId);
    const url = await createPutUrl(r2Sign, key, input.contentType);
    return { imageId, url };
  });

// R2は行から鍵を集めず、接頭辞で消す（024タスク定義・Rレビュー指摘）。
// 削除の順序（couple_members等の消える順）から独立し、再実行しても
// 同じ結果になる。post.deleteの論理削除で残っていた過去の画像も
// この機会に片付く。post.deleteはR2の失敗を握りつぶす設計（007）だが、
// ここでは握りつぶさない——catchはするが、そのまま投げ直さない
// （下のコメント参照）。失敗すればRPC全体がエラーとして返り、利用者は
// 再実行できる（024「途中で止まったら、もう一度押せば続きから進む」）
async function deleteAllByPrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  try {
    let cursor: string | undefined;
    do {
      const listed = await bucket.list({ prefix, cursor });
      if (listed.objects.length > 0) {
        await bucket.delete(listed.objects.map((object) => object.key));
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  } catch {
    // 【security-auditor指摘】R2のエラーメッセージには対象の画像キーが
    // 含まれうる。withErrorId（error-id.ts）はcatchした例外をそのまま
    // console.errorに渡すため、ここで鍵を含まない汎用メッセージへ
    // 詰め替えてから投げる（security-requirements.md 8節「画像キーを
    // ログに出さない」）。prefixそのもの（coupleId/userIdまでで、
    // imageIdを含まない）は鍵ではないため出してよい
    throw new Error(`R2からのオブジェクト削除に失敗しました（接頭辞: ${prefix}）`);
  }
}

// me.delete: アカウント削除・退会（024）。D1にインタラクティブな
// トランザクションは無いため、途中で止まる前提で組む（architecture.md 4節）。
//
// 削除の順序（couple_membersを最後の方に置く。Rレビュー指摘で訂正済み。
// docs/tasks/024-account-deletion.md「訂正: 『最初に読めなくする』は、
// 誰も守っていなかった」）:
//   1. reactions（postsとuserを参照）
//   2. posts
//   3. events
//   4. wishes（027追加。couples(id)をON DELETE no actionで参照するため、
//      couplesを消す前に消さないとFK違反で落ちる。他のcouple_id系DELETEと同じ理由）
//   5. moods（029追加。wishesと同じ理由）
//   6. invites
//   7. couple_members ← ここまで来れば、あとはcouple_idが要らない
//   8. couples
//   （相手のuser.imageをNULLに。下のコメント参照）
// 上記は1本のdb.batch()にまとめる（【security-auditor指摘】個別のrun()
// だと、削除の実行中に別リクエストが新しい投稿・予定・招待を作った場合、
// その行がposts/events/invites削除より後に着地しうる。couplesは
// posts.couple_id等からON DELETE no actionで参照されているため、その
// 状態でDELETE FROM couplesがFK違反で落ちる。このときcouple_membersは
// 既に消えているため、再実行時はcoupleIdを引けず（couple分岐ごと
// 飛ばされ）、本文・image_keyを持つ行が回収不能な孤児として恒久的に残る
// うえ、削除実行者がその投稿の著者なら以降のuser削除がFK違反で永久に
// 失敗しかねない。db.batch()は文のエラーでロールバックする
// 〈couple.tsのisConstraintViolationのコメントと同じ根拠〉ため、原子化
// すれば途中で止まる窓自体が消え、当初「残る」と受け入れていた孤児
// couples行も同時に解消する）
const meDelete = implementer.me.delete.use(authedProcedure).handler(async ({ context, errors }) => {
  const { db, bucket, user } = context;
  const userId = user.id;

  // 【Aの決定・024】不可逆で相手のデータまで消す操作のため、直近5分以内の
  // サインインを要求する。画面側（delete-account.tsx）はme.get().sessionIsFresh
  // を見て確認フローに入る前に弾くのが基本経路だが、確認をやり切る間に5分を
  // 跨ぐことはありうるため、ここがサーバ側の最終防御として必ず要る（T5）
  if (!isSessionFresh(context.sessionCreatedAt)) throw errors.REAUTH_REQUIRED();

  const coupleRow = await db
    .prepare("SELECT couple_id FROM couple_members WHERE user_id = ?1")
    .bind(userId)
    .first<{ couple_id: string }>();
  const coupleId = coupleRow?.couple_id ?? null;

  if (coupleId) {
    // 【security-auditor指摘】デモペア（is_demo=1）はGoogleログイン経路が
    // 塞がれているため現状は到達不能（seed.tsのemail_verified=0・
    // @example.com判定）だが、その到達不能性がseedの都合1つに依存する
    // 状態にしない。この手続き自身でも拒む
    const coupleRow2 = await db.prepare("SELECT is_demo FROM couples WHERE id = ?1").bind(coupleId).first<{
      is_demo: number;
    }>();
    if (coupleRow2?.is_demo) throw errors.FORBIDDEN();

    const members = await db
      .prepare("SELECT user_id FROM couple_members WHERE couple_id = ?1")
      .bind(coupleId)
      .all<{ user_id: string }>();
    const memberUserIds = members.results.map((row) => row.user_id);
    const partnerIds = memberUserIds.filter((id) => id !== userId);

    // R2の削除は行の並びから独立している（上のdeleteAllByPrefixのコメント
    // 参照）ため、D1の削除より前でも後でも構わない。ここでは先に済ませ、
    // R2側で失敗した場合にD1側の状態を一切変えずに再実行できるようにする。
    // プロフィール画像は2人分（相手の分も含む。Candle型でペアのデータごと
    // 消えるため）。
    // 【Rレビュー指摘】この順序の代償: R2が先に成功し、直後のbatch()が
    // 失敗すると、image_keyが非NULLのまま実体が無い状態が残る窓ができる
    // （me.ts冒頭の不変条件が一時的に破れる。相手のuser.imageをNULLに
    // 戻したのと同じ種類の問題が、ペアの全投稿について起こりうる）。
    // 再実行すれば同じprefixのDELETEが再度冪等に走り解消するが、その間は
    // 両者の画面で写真が壊れて見える。逆向き（D1を先に）にすると孤児
    // オブジェクトが誰からも辿れなくなる（couple_idが引けなくなるため）
    // ため、回復可能な側に倒すこの順序を維持する
    await deleteAllByPrefix(bucket, `couples/${coupleId}/posts/`);
    for (const memberId of memberUserIds) {
      await deleteAllByPrefix(bucket, `users/${memberId}/profile/`);
    }

    await db.batch([
      db
        .prepare("DELETE FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ?1)")
        .bind(coupleId),
      db.prepare("DELETE FROM posts WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM events WHERE couple_id = ?1").bind(coupleId),
      // 【027・security-auditor指摘】wishes.couple_idもcouples(id)をON DELETE
      // no actionで参照するため、これが無いと下のDELETE FROM couplesがFK違反で
      // 落ちる。couple_membersと違いwishesはcoupleIdだけで絞れる（作成者に
      // 限定しない設計。docs/tasks/027-wish-list.md 4節）ため、position自体は
      // couple_id系のどこでもよいが、他のcouple_id系DELETEと隣接させる
      db.prepare("DELETE FROM wishes WHERE couple_id = ?1").bind(coupleId),
      // 【029・タスク定義8節】moods.couple_id/user_idも同じ理由でcouples/user
      // を参照する。起票の時点でテスト項目に入れてある（027で一度踏んだ形）
      db.prepare("DELETE FROM moods WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM invites WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM couple_members WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM couples WHERE id = ?1").bind(coupleId),
      // 【security-auditor指摘】相手のuser行は残す（Candle型）が、相手の
      // プロフィール画像はR2から消すため、me.ts先頭の不変条件
      // 「image列が非NULLなら実体がある」が破れる。相手のimageもNULLに戻す
      ...partnerIds.map((partnerId) => db.prepare("UPDATE user SET image = NULL WHERE id = ?1").bind(partnerId)),
    ]);

    // 【security-auditor指摘】上のbatch()実行中というごく短い窓に新しい
    // 画像がPUTされた場合に備え、D1側が確定した後にもう一度R2を掃除する。
    // 空振り（対象0件）なら何もしない。
    // 【Rレビュー指摘】「この後にPUTされる分は到達しない」と書いていたが
    // 誤り。到達しないのは行（postsのINSERT）であって、実体（R2オブジェクト）
    // ではない。createPutUrlが返す署名付きURLは5分有効で、PUTはクライアント
    // からR2へ直接行きD1を一度も通らないため、削除の直前にme.uploadImageUrlを
    // 叩いていれば、この2回目の掃除のあともオブジェクトを置ける。実害は
    // 孤児オブジェクト（容量）だけで開示にはならないため、この窓自体は
    // 塞がず受け入れる
    await deleteAllByPrefix(bucket, `couples/${coupleId}/posts/`);
    for (const memberId of memberUserIds) {
      await deleteAllByPrefix(bucket, `users/${memberId}/profile/`);
    }
  } else {
    // ペア未所属（オンボーディング未完了）でも自分のプロフィール画像は
    // 持ちうる（me.uploadImageUrl。couple.create/invite.acceptと同じ理由で
    // ペアの成立を前提にしない）
    await deleteAllByPrefix(bucket, `users/${userId}/profile/`);
  }

  // 【Aの決定・024】invite_failuresは以前ここでuserより先に消していたが、
  // account_hash（Googleアカウントの塩付きハッシュ）へキーを差し替えた
  // ことでuserへのFKが無くなり、消す必要自体が無くなった（時間窓〈1時間〉
  // で自然に切れる設計。packages/db/src/schema/couple.tsのinviteFailures
  // コメント参照）。sessionとaccountはON DELETE cascadeで落ちる
  // （実測で確認済み）
  await db.prepare("DELETE FROM user WHERE id = ?1").bind(userId).run();

  return { ok: true as const };
});

export const meProcedures = {
  update: meUpdate,
  uploadImageUrl: meUploadImageUrl,
  delete: meDelete,
};

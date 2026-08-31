import { implementer } from "../implementer";
import { generateImageId } from "../lib/ulid";
import { createPutUrl, MAX_IMAGE_BYTES, resolveUserImage, userImageKeyFor } from "../lib/r2-signed-url";
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
// ここでは握りつぶさない——catchせず、そのまま投げる。失敗すればRPC全体が
// エラーとして返り（error-id.tsが詳細をログへ、利用者にはIDだけを返す）、
// 利用者は再実行できる（024「途中で止まったら、もう一度押せば続きから進む」）
async function deleteAllByPrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
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
//   4. invites / invite_failures
//   5. couple_members ← ここまで来れば、あとはcouple_idが要らない
//   6. couples
//   7. userを消す（sessionとaccountはON DELETE cascadeで落ちる）
// 1〜6はWHERE couple_id = ?で組むため、何度実行しても同じ結果になる
// （冪等）。resolveCoupleContextはcouple_membersからcouple_idを解決する
// ため、couple_membersを消す前にcoupleIdをローカル変数へ確保しておく
// （消してしまうと、途中で止まって再実行したとき2回目のリクエストが
// couple_idを引けなくなり、削除の手続きそのものに到達できなくなる）。
//
// resolveCoupleContextには触らない。「couplesに削除中の印を立てて
// resolveCoupleContextが弾く」案もあったが、認可の要に削除専用の例外を
// 開けることになるため採らない（005がまさにそれを潰した）
const meDelete = implementer.me.delete.use(authedProcedure).handler(async ({ context }) => {
  const { db, bucket, user } = context;
  const userId = user.id;

  const coupleRow = await db
    .prepare("SELECT couple_id FROM couple_members WHERE user_id = ?1")
    .bind(userId)
    .first<{ couple_id: string }>();
  const coupleId = coupleRow?.couple_id ?? null;

  if (coupleId) {
    // R2の削除は行の並びから独立している（上のdeleteAllByPrefixのコメント
    // 参照）ため、D1の削除より前でも後でも構わない。ここでは先に済ませ、
    // R2側で失敗した場合にD1側の状態を一切変えずに再実行できるようにする。
    // プロフィール画像は2人分（相手の分も含む。Candle型でペアのデータごと
    // 消えるため）
    const members = await db
      .prepare("SELECT user_id FROM couple_members WHERE couple_id = ?1")
      .bind(coupleId)
      .all<{ user_id: string }>();

    await deleteAllByPrefix(bucket, `couples/${coupleId}/posts/`);
    for (const member of members.results) {
      await deleteAllByPrefix(bucket, `users/${member.user_id}/profile/`);
    }

    await db
      .prepare("DELETE FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ?1)")
      .bind(coupleId)
      .run();
    await db.prepare("DELETE FROM posts WHERE couple_id = ?1").bind(coupleId).run();
    await db.prepare("DELETE FROM events WHERE couple_id = ?1").bind(coupleId).run();
    await db.prepare("DELETE FROM invites WHERE couple_id = ?1").bind(coupleId).run();
    await db.prepare("DELETE FROM couple_members WHERE couple_id = ?1").bind(coupleId).run();
    await db.prepare("DELETE FROM couples WHERE id = ?1").bind(coupleId).run();
  } else {
    // ペア未所属（オンボーディング未完了）でも自分のプロフィール画像は
    // 持ちうる（me.uploadImageUrl。couple.create/invite.acceptと同じ理由で
    // ペアの成立を前提にしない）
    await deleteAllByPrefix(bucket, `users/${userId}/profile/`);
  }

  // invite_failuresはuserを参照している。userより先に消す
  // （couple_idに依存しない表なので、上のcoupleIdの有無と関係なく消す）
  await db.prepare("DELETE FROM invite_failures WHERE user_id = ?1").bind(userId).run();
  // sessionとaccountはON DELETE cascadeで落ちる（実測で確認済み）
  await db.prepare("DELETE FROM user WHERE id = ?1").bind(userId).run();

  return { ok: true as const };
});

export const meProcedures = {
  update: meUpdate,
  uploadImageUrl: meUploadImageUrl,
  delete: meDelete,
};

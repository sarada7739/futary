import { implementer } from "../implementer";
import { isWeatherAreaCode } from "@futary/contract";
import { generateImageId } from "../lib/ulid";
import {
  albumImagePrefixFor,
  createPutUrl,
  MAX_IMAGE_BYTES,
  resolveUserImage,
  userImageKeyFor,
  wantImagePrefixFor,
} from "../lib/r2-signed-url";
import { isSessionFresh } from "../lib/reauth";
import { loadPlanRow } from "../lib/plan";
import { authedProcedure, writeProcedure } from "./base";

// postUploadUrlContract（upload.ts）と同じ値
const UPLOAD_CONTENT_TYPE = "image/jpeg";

// authedProcedure: ペア未所属でも自分のプロフィールは設定できる。
// 対象ユーザーIDを入力に持たせず、常に context.user.id だけで書く（他人のプロフィールを変更できない）
const meUpdate = implementer.me.update.use(authedProcedure).handler(async ({ context, input, errors }) => {
  const { db, bucket, r2Sign, user } = context;

  let newImageKey: string | null = null;
  if (input.imageId) {
    const key = userImageKeyFor(user.id, input.imageId);
    // 「image 列が非 NULL なら実体がある」を保つため、書く前に確認する（architecture.md 6節）
    const head = await bucket.head(key);
    if (!head) throw errors.INVALID_INPUT();
    if (head.size > MAX_IMAGE_BYTES || head.httpMetadata?.contentType !== UPLOAD_CONTENT_TYPE) {
      await bucket.delete(key);
      throw errors.INVALID_INPUT();
    }
    newImageKey = key;
  }

  // imageId 省略時は既存の画像を保つ。セッションにキャッシュされた context.user.image を
  // 書き戻すとズレうるので、DB 側の COALESCE で表す
  const row = await db
    .prepare("UPDATE user SET name = ?1, image = COALESCE(?2, image) WHERE id = ?3 RETURNING image AS image")
    .bind(input.name, newImageKey, user.id)
    .first<{ image: string | null }>();

  return { id: user.id, name: input.name, email: user.email, image: await resolveUserImage(r2Sign, row?.image ?? null) };
});

// imageId と鍵（users/{userId}/...）はサーバだけが組み立てる（architecture.md 5節・6節）
const meUploadImageUrl = implementer.me.uploadImageUrl
  .use(authedProcedure)
  .handler(async ({ context, input }) => {
    const { user, r2Sign } = context;
    const imageId = generateImageId();
    const key = userImageKeyFor(user.id, imageId);
    const url = await createPutUrl(r2Sign, key, input.contentType);
    return { imageId, url };
  });

// R2 は行から鍵を集めず接頭辞で消す。削除の順序から独立し、再実行しても同じ結果になる。
// 失敗は握りつぶさず投げる（利用者が再実行できる。024）
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
    // R2 のエラーメッセージは画像キーを含みうる。withErrorId は例外をそのままログに出すため、
    // 鍵を含まない文に詰め替える（security-requirements.md 8節）。prefix は imageId を含まないので出してよい
    throw new Error(`R2からのオブジェクト削除に失敗しました（接頭辞: ${prefix}）`);
  }
}

// me.delete: アカウント削除・退会（024）。
// 行の削除は 1 本の db.batch() にまとめる。batch は文のエラーでロールバックするので、途中で止まって
// couple_members だけ消えた状態（coupleId が引けず、孤児の行と画像が回収不能になる）を作らない。
// 並びは FK の向き（参照する側を先に）。couples(id)・user(id) を ON DELETE no action で参照する表を
// 足したら、ここにも足す（architecture.md 4節）
const meDelete = implementer.me.delete.use(authedProcedure).handler(async ({ context, errors }) => {
  const { db, bucket, user } = context;
  const userId = user.id;

  // 不可逆で相手のデータまで消すので、直近 5 分以内のサインインを要求する。
  // 画面側でも弾くが、確認の途中で 5 分を跨ぎうるのでサーバ側の最終防御として要る（024）
  if (!isSessionFresh(context.sessionCreatedAt)) throw errors.REAUTH_REQUIRED();

  const coupleRow = await db
    .prepare("SELECT couple_id FROM couple_members WHERE user_id = ?1")
    .bind(userId)
    .first<{ couple_id: string }>();
  const coupleId = coupleRow?.couple_id ?? null;

  if (coupleId) {
    // デモペアは Google ログインの経路が無いので到達しないが、それを seed の都合だけに頼らない
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

    // Stripe の購読があれば先に解約する（退会で課金が続かない）。失敗したら退会を止める
    // （まだ何も消していないので再実行できる）。Stripe 未設定で購読の行があるのは矛盾なので止める（048）
    const planRow = await loadPlanRow(db, coupleId);
    if (planRow?.stripe_subscription_id) {
      if (!context.billing) {
        throw new Error("Stripe の購読が付いたペアの退会には STRIPE_SECRET_KEY が要ります");
      }
      await context.billing.gateway.cancelSubscription(planRow.stripe_subscription_id);
    }
    // customer も消す（Checkout で入れたメールを残さない。プライバシーポリシー 4 節）。
    // 課金は上で止まっているので、失敗しても退会は止めない（残るのは customer だけ）
    if (planRow?.stripe_customer_id && context.billing) {
      try {
        await context.billing.gateway.deleteCustomer(planRow.stripe_customer_id);
      } catch (e) {
        console.log(`me.delete: stripe customer ${planRow.stripe_customer_id.slice(0, 12)} の削除に失敗: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // R2 を D1 より先に消す。逆だと couple_id が引けなくなり、孤児のオブジェクトを誰も辿れない。
    // 代償として、R2 の後に batch が失敗すると「image が非 NULL なのに実体が無い」窓ができるが、
    // 再実行で解消する回復可能な側に倒す。プロフィール画像は相手の分も消す
    await deleteAllByPrefix(bucket, `couples/${coupleId}/posts/`);
    await deleteAllByPrefix(bucket, wantImagePrefixFor(coupleId));
    await deleteAllByPrefix(bucket, albumImagePrefixFor(coupleId));
    for (const memberId of memberUserIds) {
      await deleteAllByPrefix(bucket, `users/${memberId}/profile/`);
    }

    await db.batch([
      db
        .prepare("DELETE FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ?1)")
        .bind(coupleId),
      db
        .prepare("DELETE FROM post_images WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ?1)")
        .bind(coupleId),
      db.prepare("DELETE FROM posts WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM events WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM wishes WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM moods WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM ai_summaries WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM wants WHERE couple_id = ?1").bind(coupleId),
      db
        .prepare("DELETE FROM album_photos WHERE album_id IN (SELECT id FROM albums WHERE couple_id = ?1)")
        .bind(coupleId),
      db.prepare("DELETE FROM albums WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM couple_plans WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM invites WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM couple_members WHERE couple_id = ?1").bind(coupleId),
      db.prepare("DELETE FROM couples WHERE id = ?1").bind(coupleId),
      // 相手の user 行は残すが、プロフィール画像は上で消したので image を NULL に戻す
      ...partnerIds.map((partnerId) => db.prepare("UPDATE user SET image = NULL WHERE id = ?1").bind(partnerId)),
    ]);

    // batch の間に PUT された画像に備えてもう一度掃除する。署名付き URL（5 分有効）の PUT は
    // D1 を通らないので、この後に置かれる孤児は防げない。実害は容量だけなので受け入れる
    await deleteAllByPrefix(bucket, `couples/${coupleId}/posts/`);
    await deleteAllByPrefix(bucket, wantImagePrefixFor(coupleId));
    await deleteAllByPrefix(bucket, albumImagePrefixFor(coupleId));
    for (const memberId of memberUserIds) {
      await deleteAllByPrefix(bucket, `users/${memberId}/profile/`);
    }
  } else {
    // ペア未所属でも自分のプロフィール画像は持ちうる
    await deleteAllByPrefix(bucket, `users/${userId}/profile/`);
  }

  // session・account は ON DELETE cascade で落ちる。invite_failures は user を参照しない
  // （account_hash で数え、時間窓で自然に切れる。schema/couple.ts）
  await db.prepare("DELETE FROM user WHERE id = ?1").bind(userId).run();

  return { ok: true as const };
});

// 投稿本文を外部の生成AIへ送ることへの同意（ADR-013）。自分の分だけ変える。
// user_id を入力に取らない（渡せないものは間違えて渡せない。037）
const meSetAiOptIn = implementer.me.setAiOptIn.use(writeProcedure).handler(async ({ context, input }) => {
  const { db, coupleId, userId } = context;
  await db
    .prepare("UPDATE couple_members SET ai_opt_in = ?1 WHERE couple_id = ?2 AND user_id = ?3")
    .bind(input.optIn, coupleId, userId)
    .run();
  return { aiOptIn: input.optIn };
});

// 表に無いコードは INVALID_INPUT。fetch する URL に差し込むのは表のコードだけ
// （security-requirements.md。058）。null で「設定しない」
const meUpdateWeatherArea = implementer.me.updateWeatherArea.use(writeProcedure).handler(async ({ context, input, errors }) => {
  const { db, coupleId, userId } = context;
  if (input.areaCode !== null && !isWeatherAreaCode(input.areaCode)) throw errors.INVALID_INPUT();
  await db
    .prepare("UPDATE couple_members SET weather_area = ?1 WHERE couple_id = ?2 AND user_id = ?3")
    .bind(input.areaCode, coupleId, userId)
    .run();
  return {};
});

export const meProcedures = {
  update: meUpdate,
  uploadImageUrl: meUploadImageUrl,
  delete: meDelete,
  setAiOptIn: meSetAiOptIn,
  updateWeatherArea: meUpdateWeatherArea,
};

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

export const meProcedures = {
  update: meUpdate,
  uploadImageUrl: meUploadImageUrl,
};

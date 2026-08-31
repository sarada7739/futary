import { oc } from "@orpc/contract";
import { z } from "zod";
import { IMAGE_ID_PATTERN } from "./post";

const MAX_NAME_LENGTH = 20;

// me.get: 現在ログイン中のユーザー。未認証なら null を返す
// （デモ閲覧モードの返却は未実装。005 以降でペア情報とあわせて拡張する）
export const meGetContract = oc.output(
  z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.email(),
      // Google のプロフィール画像URL、または自分でアップロードした画像の
      // 署名付きGET URL（019）。どちらであってもクライアントからは区別しない
      image: z.string().nullable(),
    })
    .nullable(),
);

// me.update: 名前とアイコン画像を変更する（019）。認証済みなら誰でも呼べる
// （ペア未所属でも自分のプロフィールは設定できるため authedProcedure の上に
// 載せる。couple.create/invite.acceptと同じ理由）。
// imageId は me.uploadImageUrl がサーバ側で発行したものだけが有効
// （post.createのimageIdと同じ形。architecture.md 5節）。形式の検証
// （IMAGE_ID_PATTERN）もpost.createと共有する（Rレビュー指摘: 同じ形で鍵を
// 組み立てる〈users/{userId}/profile/{imageId}.jpg〉以上、007の「入力で
// 構造的に閉じる」判断をこちらにも引き継ぐ必要がある。現状は他の仕組みが
// たまたま噛み合って悪用を防いでいるだけで、それに頼らない）。
// 省略時は既存の画像を変更しない（外す操作は用意しない。要望に無いものを
// 先回りして作らない）
export const meUpdateContract = oc
  .input(
    z.object({
      name: z.string().trim().min(1, "名前を入力してください").max(MAX_NAME_LENGTH),
      imageId: z.string().regex(IMAGE_ID_PATTERN).optional(),
    }),
  )
  .output(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.email(),
      image: z.string().nullable(),
    }),
  )
  .errors({
    FORBIDDEN: {},
    // imageIdに対応するR2の実体が無い場合
    INVALID_INPUT: { status: 400 },
  });

const CONTENT_TYPE = "image/jpeg";

// me.uploadImageUrl: プロフィール画像用の署名付きPUT URL（007のpost.uploadUrlと
// 同じ形。architecture.md 5節・6節）。ペアに属さない個人の持ち物のため、
// 鍵の前綴りは couples/{coupleId}/... とは別にする（apps/api/src/lib/r2-signed-url.ts）
export const meUploadImageUrlContract = oc
  .input(z.object({ contentType: z.literal(CONTENT_TYPE) }))
  .output(z.object({ imageId: z.string(), url: z.string() }))
  .errors({
    FORBIDDEN: {},
  });

// me.delete: アカウント削除・退会（024）。所属しているペアがあれば、
// ペアのデータ（投稿・リアクション・カレンダー・招待コード）ごと消える
// （Candle型。docs/tasks/024-account-deletion.md）。入力は受け取らない
// （常にcontext.user.idだけを対象にする。他人のアカウントを消せないことを
// 構造的に保証する。me.updateと同じ考え方）
export const meDeleteContract = oc.output(z.object({ ok: z.literal(true) })).errors({
  FORBIDDEN: {},
});

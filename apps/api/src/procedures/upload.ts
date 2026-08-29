import { implementer } from "../implementer";
import { generateImageId } from "../lib/ulid";
import { createPutUrl, imageKeyFor } from "../lib/r2-signed-url";
import { writeProcedure } from "./base";

// writeProcedure の上に載せる。デモ（未認証・readonly）からは呼べない
// （architecture.md 6節: アップロードは書き込み系の操作）。
// imageId はサーバが生成し、鍵（couple_id を含む）もサーバだけが組み立てる。
// contentType は contract 側で "image/jpeg" のみを許す z.literal になっている
export const postUploadUrl = implementer.post.uploadUrl.use(writeProcedure).handler(async ({ context, input }) => {
  const { coupleId, r2Sign } = context;
  const imageId = generateImageId();
  const key = imageKeyFor(coupleId, imageId);
  const url = await createPutUrl(r2Sign, key, input.contentType);
  return { imageId, url };
});

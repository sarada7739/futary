import { implementer } from "../implementer";
import { generateImageId } from "../lib/ulid";
import { createPutUrl, imageKeyFor } from "../lib/r2-signed-url";
import { writeProcedure } from "./base";

// デモ（readonly）からは呼べない（アップロードは書き込み。architecture.md 6節）。
// imageId と鍵（couple_id を含む）はサーバだけが組み立てる。contentType は契約で "image/jpeg" だけ
export const postUploadUrl = implementer.post.uploadUrl.use(writeProcedure).handler(async ({ context, input }) => {
  const { coupleId, r2Sign } = context;
  const imageId = generateImageId();
  const key = imageKeyFor(coupleId, imageId);
  const url = await createPutUrl(r2Sign, key, input.contentType);
  return { imageId, url };
});

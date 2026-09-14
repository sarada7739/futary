import { describe, expect, it } from "vitest";
import {
  albumImageKeyFor,
  albumImagePrefixFor,
  createDownloadUrl,
  createGetUrl,
  imageIdOfKey,
  resolveUserImage,
  userImageKeyFor,
  type R2SignConfig,
} from "../src/lib/r2-signed-url";

// post.test.ts と同じ理由（実際の R2 API トークンの設定有無にテストの合否を左右させない）
const r2Sign: R2SignConfig = {
  accountId: "test-account",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  bucketName: "test-bucket",
};

// 019: user.image は Google の外部URLと、自分でアップロードした画像のR2キーの
// 両方がありうる。前綴り（userImageKeyFor）で判別し、後者だけ署名付きGET URLへ
// 解決する（apps/api/src/procedures/me.ts・post.ts・stats.tsで共通に使う）
describe("resolveUserImage", () => {
  it("nullはnullのまま返す", async () => {
    expect(await resolveUserImage(r2Sign, null)).toBeNull();
  });

  it("Googleの外部URL（users/で始まらない）はそのまま返す", async () => {
    const googleUrl = "https://lh3.googleusercontent.com/a/example";
    expect(await resolveUserImage(r2Sign, googleUrl)).toBe(googleUrl);
  });

  it("自分でアップロードした画像のキー（users/で始まる）は署名付きGET URLに変わる", async () => {
    const key = userImageKeyFor("user-1", "IMAGE01");
    const resolved = await resolveUserImage(r2Sign, key);

    expect(resolved).not.toBe(key);
    expect(resolved).toContain(key);
    expect(resolved).toMatch(/^https:\/\//);
  });
});

describe("userImageKeyFor", () => {
  it("couples/... とは別の前綴り（users/）にする（ペアに属さない個人の持ち物のため）", () => {
    const key = userImageKeyFor("user-1", "IMAGE01");
    expect(key.startsWith("users/")).toBe(true);
    expect(key).not.toContain("couples/");
  });
});

// 041: 保存用の署名付き URL
describe("createDownloadUrl", () => {
  it("response-content-disposition=attachment; filename=... と 5 分の期限がクエリに入り、署名される", async () => {
    const imageId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const key = albumImageKeyFor("couple-1", imageId);
    // filename はサーバが組み立てる形（nisoine-YYYYMMDD-{imageId}.jpg）。変数から組む
    const filename = `nisoine-20260816-${imageId}.jpg`;
    const url = new URL(await createDownloadUrl(r2Sign, key, filename));

    expect(url.pathname).toBe(`/test-bucket/${key}`);
    expect(url.searchParams.get("response-content-disposition")).toBe(`attachment; filename="${filename}"`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("表示用の URL とは署名が違う（クエリが署名に含まれている）", async () => {
    const key = albumImageKeyFor("couple-1", "01ARZ3NDEKTSV4RRFFQ69G5FAV");
    const display = new URL(await createGetUrl(r2Sign, key));
    const download = new URL(await createDownloadUrl(r2Sign, key, "a.jpg"));
    expect(display.searchParams.get("response-content-disposition")).toBeNull();
    expect(download.searchParams.get("X-Amz-Signature")).not.toBe(display.searchParams.get("X-Amz-Signature"));
  });
});

describe("albumImageKeyFor / imageIdOfKey", () => {
  it("albums/ の接頭辞で、posts/・wants/ とは別", () => {
    const key = albumImageKeyFor("couple-1", "IMAGE01");
    expect(key).toBe("couples/couple-1/albums/IMAGE01.jpg");
    expect(key.startsWith(albumImagePrefixFor("couple-1"))).toBe(true);
    expect(key).not.toContain("/posts/");
  });

  it("鍵の末尾から imageId を取り出す（投稿・アルバムのどちらの鍵でも）", () => {
    expect(imageIdOfKey("couples/c/posts/ABC.jpg")).toBe("ABC");
    expect(imageIdOfKey(albumImageKeyFor("c", "XYZ"))).toBe("XYZ");
  });
});

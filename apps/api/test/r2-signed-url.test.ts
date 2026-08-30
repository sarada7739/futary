import { describe, expect, it } from "vitest";
import { resolveUserImage, userImageKeyFor, type R2SignConfig } from "../src/lib/r2-signed-url";

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

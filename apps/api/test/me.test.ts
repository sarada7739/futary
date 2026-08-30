import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { describe, expect, it } from "vitest";
import type { Contract } from "@futary/contract";
import type { ContractRouterClient } from "@orpc/contract";
import app from "../src/index";
import type { Bindings } from "../src/index";
import { router } from "../src/router";
import { generateImageId } from "../src/lib/ulid";
import { userImageKeyFor } from "../src/lib/r2-signed-url";
import type { RpcContext } from "../src/context";

function createTestClient(): ContractRouterClient<Contract> {
  const link = new RPCLink({
    url: "http://localhost/api",
    fetch: async (request, init) =>
      app.fetch(new Request(request, init), env as unknown as Bindings),
  });
  return createORPCClient(link);
}

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

// post.test.ts と同じ理由（実際の R2 API トークンの設定有無にテストの合否を左右させない）
const r2Sign: RpcContext["r2Sign"] = {
  accountId: "test-account",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  bucketName: "test-bucket",
};

let userSeq = 0;

async function createUser(): Promise<{ id: string; name: string; email: string }> {
  userSeq += 1;
  const id = `user-${userSeq}-${crypto.randomUUID()}`;
  const name = `テストユーザー${userSeq}`;
  const email = `user-${userSeq}-${crypto.randomUUID()}@example.com`;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    )
    .bind(id, name, email, now)
    .run();
  return { id, name, email };
}

function contextFor(user: { id: string; name: string; email: string } | null): RpcContext {
  return { db, bucket, r2Sign, user: user ? { ...user, image: null } : null, ip: "203.0.113.1", demoCoupleId: null };
}

// me.uploadImageUrl を経由せず R2 に直接オブジェクトを置く。「アップロード済み」を
// 模擬する（post.test.ts の uploadTestImage と同じ形）
async function uploadTestUserImage(userId: string, sizeBytes = 100, contentType = "image/jpeg"): Promise<string> {
  const imageId = generateImageId();
  await bucket.put(userImageKeyFor(userId, imageId), new Uint8Array(sizeBytes), {
    httpMetadata: { contentType },
  });
  return imageId;
}

describe("me.get", () => {
  it("未認証なら null を返す", async () => {
    const client = createTestClient();

    const result = await client.me.get();

    expect(result).toBeNull();
  });
});

describe("/api/auth/*", () => {
  it("Better Auth のセッション確認エンドポイントに到達できる（未認証）", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/get-session"),
      env as unknown as Bindings,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("sign-out はセッションが無くてもエラーにならない", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/sign-out", { method: "POST" }),
      env as unknown as Bindings,
    );

    expect(res.status).toBeLessThan(500);
  });

  it("expo-authorization-proxy は塞がれている（オープンリダイレクト対策）", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/expo-authorization-proxy"),
      env as unknown as Bindings,
    );

    expect(res.status).toBe(404);
  });
});

// 019: 名前とアイコン画像の変更
describe("me.update", () => {
  it("名前を変更できる", async () => {
    const user = await createUser();

    const updated = await call(router.me.update, { name: "新しい名前" }, { context: contextFor(user) });

    expect(updated.name).toBe("新しい名前");
    const row = await db.prepare("SELECT name FROM user WHERE id = ?1").bind(user.id).first<{ name: string }>();
    expect(row?.name).toBe("新しい名前");
  });

  it("imageIdを省略すると既存の画像は変更されない", async () => {
    const user = await createUser();
    await db.prepare("UPDATE user SET image = ?1 WHERE id = ?2").bind("https://example.com/old.jpg", user.id).run();

    const updated = await call(router.me.update, { name: user.name }, { context: contextFor(user) });

    expect(updated.image).toBe("https://example.com/old.jpg");
  });

  it("アップロード済みのimageIdを指定すると画像が変わり、署名付きURLが返る", async () => {
    const user = await createUser();
    const imageId = await uploadTestUserImage(user.id);

    const updated = await call(router.me.update, { name: user.name, imageId }, { context: contextFor(user) });

    expect(updated.image).not.toBeNull();
    expect(updated.image).toContain(userImageKeyFor(user.id, imageId));

    const row = await db.prepare("SELECT image FROM user WHERE id = ?1").bind(user.id).first<{ image: string }>();
    expect(row?.image).toBe(userImageKeyFor(user.id, imageId));
  });

  it("アップロードされていないimageId（形式は正規）を指定するとINVALID_INPUT", async () => {
    const user = await createUser();
    // generateImageIdと同じ形式（26文字のULID）だが実際にはアップロードしていない
    const notUploadedImageId = generateImageId();

    await expect(
      call(router.me.update, { name: user.name, imageId: notUploadedImageId }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  // Rレビュー指摘: post.createのimageId（007 security-auditor指摘）と同じ形で
  // 鍵を組み立てる以上、形式検証も共有する（packages/contract/src/post.tsの
  // IMAGE_ID_PATTERN）。パス区切り等を混入させる形式は入力段階で拒否される
  it("不正な形式のimageIdは入力バリデーションで弾かれる", async () => {
    const user = await createUser();

    await expect(
      call(router.me.update, { name: user.name, imageId: "../../etc/passwd" }, { context: contextFor(user) }),
    ).rejects.toThrow();
  });

  it("他人がアップロードした画像のimageIdを指定してもINVALID_INPUT（別ユーザーの鍵になるため実体が無い）", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const imageId = await uploadTestUserImage(userA.id);

    await expect(
      call(router.me.update, { name: userB.name, imageId }, { context: contextFor(userB) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("空の名前は入力バリデーションで弾かれる", async () => {
    const user = await createUser();

    await expect(call(router.me.update, { name: "" }, { context: contextFor(user) })).rejects.toThrow();
  });

  it("21文字の名前は入力バリデーションで弾かれる（上限20文字）", async () => {
    const user = await createUser();

    await expect(
      call(router.me.update, { name: "あ".repeat(21) }, { context: contextFor(user) }),
    ).rejects.toThrow();
  });

  it("未認証なら FORBIDDEN", async () => {
    await expect(call(router.me.update, { name: "名前" }, { context: contextFor(null) })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("me.uploadImageUrl", () => {
  it("認証済みユーザーが署名付きPUT URLを取得できる", async () => {
    const user = await createUser();

    const result = await call(router.me.uploadImageUrl, { contentType: "image/jpeg" }, { context: contextFor(user) });

    expect(result.imageId).toBeTruthy();
    expect(result.url).toContain(userImageKeyFor(user.id, result.imageId));
  });

  it("呼ぶたびに異なるimageIdが発行される（couples/...とは別のusers/...前綴り）", async () => {
    const user = await createUser();

    const first = await call(router.me.uploadImageUrl, { contentType: "image/jpeg" }, { context: contextFor(user) });
    const second = await call(router.me.uploadImageUrl, { contentType: "image/jpeg" }, { context: contextFor(user) });

    expect(first.imageId).not.toBe(second.imageId);
    expect(first.url).toContain("users/");
    expect(first.url).not.toContain("couples/");
  });

  it("未認証なら FORBIDDEN", async () => {
    await expect(
      call(router.me.uploadImageUrl, { contentType: "image/jpeg" }, { context: contextFor(null) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

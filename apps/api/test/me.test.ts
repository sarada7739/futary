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
import { REAUTH_WINDOW_MS } from "../src/lib/reauth";
import {
  albumImageKeyFor,
  albumImagePrefixFor,
  imageKeyFor,
  userImageKeyFor,
  wantImageKeyFor,
  wantImagePrefixFor,
} from "../src/lib/r2-signed-url";
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
  await db.batch([
    db
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
      )
      .bind(id, name, email, now),
    // ペア成立に使う invite.accept が account_id（Google の識別子）を引く（024）
    db
      .prepare(
        "INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at) VALUES (?1, 'google', ?2, 'google', ?3, ?4, ?4)",
      )
      .bind(crypto.randomUUID(), `google-sub-${id}`, id, now),
  ]);
  return { id, name, email };
}

// me.delete の再認証（sessionIsFresh）を試すため、sessionCreatedAt を上書きできる。
// 省略時は「たった今サインインした」
function contextFor(
  user: { id: string; name: string; email: string } | null,
  options: { sessionCreatedAt?: number | null } = {},
): RpcContext {
  return {
    db,
    bucket,
    r2Sign,
    aiEnv: { provider: "openai", openaiApiKey: "test-openai-key" },
    user: user ? { ...user, image: null } : null,
    ip: "203.0.113.1",
    demoCoupleId: null,
    sessionCreatedAt: user ? (options.sessionCreatedAt ?? Date.now()) : null,
    authSecret: "test-secret",
  };
}

// me.uploadImageUrl を経由せず R2 に直接置いて「アップロード済み」を模擬する
async function uploadTestUserImage(userId: string, sizeBytes = 100, contentType = "image/jpeg"): Promise<string> {
  const imageId = generateImageId();
  await bucket.put(userImageKeyFor(userId, imageId), new Uint8Array(sizeBytes), {
    httpMetadata: { contentType },
  });
  return imageId;
}

// me.delete のテストで使う（024）
async function createCouple(user: { id: string; name: string; email: string }) {
  return call(router.couple.create, {}, { context: contextFor(user) });
}

async function uploadTestPostImage(coupleId: string, sizeBytes = 100, contentType = "image/jpeg"): Promise<string> {
  const imageId = generateImageId();
  await bucket.put(imageKeyFor(coupleId, imageId), new Uint8Array(sizeBytes), {
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

  // 削除確認画面に入れるかはサーバが真偽値で返す（時刻を返してクライアントに比べさせない。
  // event.ts の canEdit と同じ理由。024）
  it("直近5分以内にサインインしていればsessionIsFreshはtrue", async () => {
    const user = await createUser();

    const result = await call(router.me.get, undefined, { context: contextFor(user) });

    expect(result?.sessionIsFresh).toBe(true);
  });

  it("サインインから5分を超えているとsessionIsFreshはfalse", async () => {
    const user = await createUser();
    const staleSessionCreatedAt = Date.now() - REAUTH_WINDOW_MS - 1000;

    const result = await call(router.me.get, undefined, {
      context: contextFor(user, { sessionCreatedAt: staleSessionCreatedAt }),
    });

    expect(result?.sessionIsFresh).toBe(false);
  });

  // ペア未所属なら couple_members に行が無いので両方 false（037）
  it("ペア未所属ならaiOptIn/partnerAiOptInは両方false", async () => {
    const user = await createUser();

    const result = await call(router.me.get, undefined, { context: contextFor(user) });

    expect(result?.aiOptIn).toBe(false);
    expect(result?.partnerAiOptIn).toBe(false);
  });

  it("自分が同意するとaiOptInがtrueになり、相手のpartnerAiOptInにも反映される", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });

    await call(router.me.setAiOptIn, { optIn: true }, { context: contextFor(owner) });

    const ownerView = await call(router.me.get, undefined, { context: contextFor(owner) });
    expect(ownerView?.aiOptIn).toBe(true);
    expect(ownerView?.partnerAiOptIn).toBe(false);

    const partnerView = await call(router.me.get, undefined, { context: contextFor(partner) });
    expect(partnerView?.aiOptIn).toBe(false);
    expect(partnerView?.partnerAiOptIn).toBe(true);
  });
});

describe("me.setAiOptIn", () => {
  it("自分の分だけ変更する（相手の行には影響しない）", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });

    const result = await call(router.me.setAiOptIn, { optIn: true }, { context: contextFor(owner) });
    expect(result).toEqual({ aiOptIn: true });

    const partnerView = await call(router.me.get, undefined, { context: contextFor(partner) });
    expect(partnerView?.aiOptIn).toBe(false);
  });

  it("falseへ戻せる", async () => {
    const owner = await createUser();
    await createCouple(owner);

    await call(router.me.setAiOptIn, { optIn: true }, { context: contextFor(owner) });
    const result = await call(router.me.setAiOptIn, { optIn: false }, { context: contextFor(owner) });
    expect(result).toEqual({ aiOptIn: false });
  });

  // couple_members に行が無いと writeProcedure が NEEDS_ONBOARDING で弾く
  it("ペア未所属だとNEEDS_ONBOARDING", async () => {
    const user = await createUser();

    await expect(
      call(router.me.setAiOptIn, { optIn: true }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("未認証（デモ）はFORBIDDEN", async () => {
    const owner = await createUser();
    const couple = await createCouple(owner);
    await db.prepare("UPDATE couples SET is_demo = 1 WHERE id = ?1").bind(couple.id).run();

    const demoContext: RpcContext = {
      db,
      bucket,
      r2Sign,
      aiEnv: { provider: "openai", openaiApiKey: "test-openai-key" },
      user: null,
      ip: "203.0.113.1",
      demoCoupleId: couple.id,
      sessionCreatedAt: null,
      authSecret: "test-secret",
    };

    await expect(
      call(router.me.setAiOptIn, { optIn: true }, { context: demoContext }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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

// 名前とアイコン画像の変更（019）
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
    // ULID の形式だが、実際にはアップロードしていない
    const notUploadedImageId = generateImageId();

    await expect(
      call(router.me.update, { name: user.name, imageId: notUploadedImageId }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  // post.create の imageId と同じ形で鍵を組み立てるので、形式検証も共有する
  // （packages/contract/src/post.ts の IMAGE_ID_PATTERN）。パス区切り等は入力段階で拒む
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

// アカウント削除と退会（024）
describe("me.delete", () => {
  it("未認証なら FORBIDDEN", async () => {
    await expect(call(router.me.delete, undefined, { context: contextFor(null) })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("ペア未所属でも削除でき、自分のプロフィール画像もR2から消える", async () => {
    const user = await createUser();
    const imageId = await uploadTestUserImage(user.id);
    await call(router.me.update, { name: user.name, imageId }, { context: contextFor(user) });

    const result = await call(router.me.delete, undefined, { context: contextFor(user) });

    expect(result.ok).toBe(true);
    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(user.id).first()).toBeNull();
    expect(await bucket.head(userImageKeyFor(user.id, imageId))).toBeNull();
  });

  it("ペアの全データが消え、相手もペアを読めなくなる（Candle型: 相手のuser行自体は残る）", async () => {
    const owner = await createUser();
    const couple = await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });

    const ownerImageId = await uploadTestUserImage(owner.id);
    await call(router.me.update, { name: owner.name, imageId: ownerImageId }, { context: contextFor(owner) });
    const partnerImageId = await uploadTestUserImage(partner.id);
    await call(router.me.update, { name: partner.name, imageId: partnerImageId }, { context: contextFor(partner) });

    const postImageId = await uploadTestPostImage(couple.id);
    const post = await call(
      router.post.create,
      { body: "テスト投稿", images: [{ imageId: postImageId, width: 100, height: 100 }] },
      { context: contextFor(owner) },
    );
    await call(router.reaction.toggle, { postId: post.id, kind: "heart" }, { context: contextFor(partner) });
    await call(
      router.event.create,
      { date: "2020-01-01", title: "予定", kind: "plan", repeatYearly: false, startTime: null, endTime: null, isShared: false },
      { context: contextFor(owner) },
    );
    // wishes.couple_id も couples(id) を参照する。消さずに couples を消すと FK 違反で batch 全体が
    // 失敗し、アカウント削除が恒久的にできなくなる（027）
    await call(router.wish.create, { title: "テストの行きたい場所" }, { context: contextFor(owner) });
    // wants.couple_id / owner_id も couples / user を参照する。画像は wants/ 接頭辞の R2
    // オブジェクトとして直接置く（040 T7）
    const wantImageId = generateImageId();
    await bucket.put(wantImageKeyFor(couple.id, wantImageId, "jpg"), new Uint8Array(100), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await call(router.want.create, { title: "テストのほしいもの", imageId: wantImageId }, { context: contextFor(owner) });
    // 相手の分も（owner_id が相手）
    await call(router.want.create, { title: "相手のほしいもの" }, { context: contextFor(partner) });
    // albums.couple_id / created_by が couples / user を、album_photos.album_id が albums を参照する。
    // 写真は albums/ 接頭辞の R2 オブジェクトとして置く（041 T8）
    const albumImageId = generateImageId();
    await bucket.put(albumImageKeyFor(couple.id, albumImageId), new Uint8Array(100), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    const album = await call(
      router.album.create,
      { title: "テストのアルバム", cover: { imageId: albumImageId, width: 100, height: 100 } },
      { context: contextFor(owner) },
    );
    // moods.couple_id も couples を参照する（029）
    await call(router.mood.setToday, { level: 5 }, { context: contextFor(owner) });
    // ai_summaries.couple_id も couples を参照する。aiSummary.generate は本物の API を呼ぶので
    // 使わず、行を直接作る（037）
    await db
      .prepare(
        `INSERT INTO ai_summaries (couple_id, period_kind, period_key, body, provider, model, generated_count, created_at, updated_at)
         VALUES (?1, 'month', '2026-01', 'テストのまとめ', 'openai', 'gpt-4o-mini', 1, ?2, ?2)`,
      )
      .bind(couple.id, Math.floor(Date.now() / 1000))
      .run();

    const result = await call(router.me.delete, undefined, { context: contextFor(owner) });
    expect(result.ok).toBe(true);

    // D1: ペアに紐づく行が全て消える
    expect(await db.prepare("SELECT id FROM couples WHERE id = ?1").bind(couple.id).first()).toBeNull();
    expect(
      await db.prepare("SELECT 1 FROM couple_members WHERE couple_id = ?1").bind(couple.id).first(),
    ).toBeNull();
    expect(await db.prepare("SELECT id FROM posts WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM reactions WHERE post_id = ?1").bind(post.id).first()).toBeNull();
    // post_images は couple_id 列を持たない（posts を post_id で参照する側）ので、下の機械的な
    // 走査には拾われない。手で確認する
    expect(await db.prepare("SELECT 1 FROM post_images WHERE post_id = ?1").bind(post.id).first()).toBeNull();
    expect(await db.prepare("SELECT id FROM events WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT code FROM invites WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT id FROM wishes WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM moods WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM ai_summaries WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM wants WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    // album_photos も couple_id 列を持たないので手で確認する（041 T8）
    expect(await db.prepare("SELECT 1 FROM albums WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM album_photos WHERE album_id = ?1").bind(album.id).first()).toBeNull();

    // 自分の user 行は消え、相手の user 行は Candle 型として残る（消えるのはペアのデータだけ）
    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(owner.id).first()).toBeNull();
    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(partner.id).first()).not.toBeNull();

    // R2: 投稿画像・プロフィール画像（2人分）が消える
    expect(await bucket.head(imageKeyFor(couple.id, postImageId))).toBeNull();
    expect(await bucket.head(userImageKeyFor(owner.id, ownerImageId))).toBeNull();
    expect(await bucket.head(userImageKeyFor(partner.id, partnerImageId))).toBeNull();
    // wants/ に孤児が残らない（040 T7）
    expect(await bucket.head(wantImageKeyFor(couple.id, wantImageId, "jpg"))).toBeNull();
    expect((await bucket.list({ prefix: wantImagePrefixFor(couple.id) })).objects).toHaveLength(0);
    // albums/ に孤児が残らない（041 T8）
    expect(await bucket.head(albumImageKeyFor(couple.id, albumImageId))).toBeNull();
    expect((await bucket.list({ prefix: albumImagePrefixFor(couple.id) })).objects).toHaveLength(0);

    // 相手もどの手続きからもペアのデータを読めなくなる
    await expect(call(router.couple.get, undefined, { context: contextFor(partner) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  // couple_members を消した時点で、残りの行が残っていても両方の利用者がどの手続きからも
  // ペアのデータを読めない（024）。途中の状態を作るため、削除手順（1〜5）を SQL で再現する
  it("couple_membersを消した時点で、残りの行が残っていても両方の利用者がペアを読めなくなる", async () => {
    const owner = await createUser();
    const couple = await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
    await call(router.post.create, { body: "投稿" }, { context: contextFor(owner) });
    await call(router.wish.create, { title: "行きたい場所" }, { context: contextFor(owner) });

    await db
      .prepare("DELETE FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ?1)")
      .bind(couple.id)
      .run();
    await db.prepare("DELETE FROM posts WHERE couple_id = ?1").bind(couple.id).run();
    await db.prepare("DELETE FROM events WHERE couple_id = ?1").bind(couple.id).run();
    await db.prepare("DELETE FROM wishes WHERE couple_id = ?1").bind(couple.id).run();
    await db.prepare("DELETE FROM invites WHERE couple_id = ?1").bind(couple.id).run();
    await db.prepare("DELETE FROM couple_members WHERE couple_id = ?1").bind(couple.id).run();

    // couples の行はまだ残っている（読めなくなることの証明で、消えていることの証明ではない）
    expect(await db.prepare("SELECT id FROM couples WHERE id = ?1").bind(couple.id).first()).not.toBeNull();

    await expect(call(router.couple.get, undefined, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
    await expect(call(router.couple.get, undefined, { context: contextFor(partner) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  // reactions〜couples（手順1〜6）は db.batch() 1 本なので、me.delete の実行中に途中経過は
  // 起こらない。ここでは「一部の行が既に無い状態で me.delete を呼んでも、残りを片付けて
  // 完走する」（WHERE 句の冪等性。過去の失敗した試行やバグで一部だけ消えていた場合の後始末）
  // を確かめる
  it.each([
    ["何も止めない", 0],
    ["reactions削除後で止める", 1],
    ["posts削除後で止める", 2],
    ["events削除後で止める", 3],
    ["wishes削除後で止める", 4],
    ["invites削除後で止める", 5],
  ] as const)("%s: 再実行すると最後まで進み、同じ結果になる", async (_label, stopAt) => {
    const owner = await createUser();
    const couple = await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
    const post = await call(router.post.create, { body: "投稿" }, { context: contextFor(owner) });
    await call(router.reaction.toggle, { postId: post.id, kind: "heart" }, { context: contextFor(partner) });
    await call(router.wish.create, { title: "行きたい場所" }, { context: contextFor(owner) });

    const steps = [
      () =>
        db
          .prepare("DELETE FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ?1)")
          .bind(couple.id)
          .run(),
      () => db.prepare("DELETE FROM posts WHERE couple_id = ?1").bind(couple.id).run(),
      () => db.prepare("DELETE FROM events WHERE couple_id = ?1").bind(couple.id).run(),
      () => db.prepare("DELETE FROM wishes WHERE couple_id = ?1").bind(couple.id).run(),
      () => db.prepare("DELETE FROM invites WHERE couple_id = ?1").bind(couple.id).run(),
    ];
    for (let i = 0; i < stopAt; i++) {
      await steps[i]?.();
    }

    const result = await call(router.me.delete, undefined, { context: contextFor(owner) });
    expect(result.ok).toBe(true);

    expect(await db.prepare("SELECT id FROM couples WHERE id = ?1").bind(couple.id).first()).toBeNull();
    expect(
      await db.prepare("SELECT 1 FROM couple_members WHERE couple_id = ?1").bind(couple.id).first(),
    ).toBeNull();
    expect(await db.prepare("SELECT id FROM posts WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT id FROM wishes WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(owner.id).first()).toBeNull();
  });

  // couple_id 列を持つ表を sqlite_master から機械的に見つけ、その全表で me.delete 後にペアの行が
  // 0 件であることを確かめる。手で並べた一覧だと、表を足したときに削除文の足し忘れ（FK 違反で
  // 削除が恒久的に失敗する）を見逃す（authorization.test.ts の collectProcedures と同じ考え方）
  it("couple_id列を持つ全ての表で、me.delete後にそのペアの行が0件になる", async () => {
    const owner = await createUser();
    const couple = await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
    await call(router.post.create, { body: "投稿" }, { context: contextFor(owner) });
    await call(
      router.event.create,
      { date: "2020-01-01", title: "予定", kind: "plan", repeatYearly: false, isShared: false },
      { context: contextFor(owner) },
    );
    await call(router.wish.create, { title: "行きたい場所" }, { context: contextFor(owner) });
    // wants・albums・moods も couple_id を持つ表として機械的に拾われる
    await call(router.want.create, { title: "ほしいもの" }, { context: contextFor(owner) });
    await call(router.album.create, { title: "アルバム" }, { context: contextFor(owner) });
    await call(router.mood.setToday, { level: 3 }, { context: contextFor(owner) });
    // couple_plans.couple_id も couples を参照する。運営の切り替え SQL と同じ文で行を作る（045 T6）
    await db
      .prepare(
        "INSERT INTO couple_plans (couple_id, plan, source, updated_at) VALUES (?1, 'paid', 'manual', unixepoch()) ON CONFLICT(couple_id) DO UPDATE SET plan = 'paid', updated_at = unixepoch()",
      )
      .bind(couple.id)
      .run();
    // ai_summaries も機械的に拾われる。aiSummary.generate は本物の API を呼ぶので行を直接作る
    await db
      .prepare(
        `INSERT INTO ai_summaries (couple_id, period_kind, period_key, body, provider, model, generated_count, created_at, updated_at)
         VALUES (?1, 'month', '2026-01', 'テストのまとめ', 'openai', 'gpt-4o-mini', 1, ?2, ?2)`,
      )
      .bind(couple.id, Math.floor(Date.now() / 1000))
      .run();

    // D1 は PRAGMA を許さない（SQLITE_AUTH）ので、schema-integrity.test.ts の extractNamedChecks と
    // 同じく sqlite_master の CREATE TABLE 文字列から列名を拾う
    const { results: tables } = await db
      .prepare(`SELECT name AS name, sql AS sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'couples'`)
      .all<{ name: string; sql: string }>();

    // バッククォートを必須にすると、バッククォート無しで書いた表を静かに見逃す。緩めても誤検知は
    // 増えない（`WHERE couple_id = ?` が通らない表があれば下の before チェックで落ちる。fail-closed）。
    // admin_actions は couple_id を持つが FK は無く、退会しても残す（運営の操作の記録。057 0節 #10）。
    // この網からは外し、残ることを別に見る
    const KEPT_AFTER_DELETE = new Set(["admin_actions"]);
    const allCoupleIdTables = tables.filter((t) => /couple_id/.test(t.sql)).map((t) => t.name);
    expect(allCoupleIdTables).toContain("admin_actions");
    const coupleIdTables = allCoupleIdTables.filter((name) => !KEPT_AFTER_DELETE.has(name));
    await db
      .prepare("INSERT INTO admin_actions (id, admin_user_id, action, couple_id, detail, created_at) VALUES (?1, ?2, 'plan.set', ?3, '{}', unixepoch())")
      .bind(crypto.randomUUID(), owner.id, couple.id)
      .run();

    // 既知の表が含まれている（0 件だと下のループが何も確かめずに通る）
    expect(coupleIdTables).toEqual(
      expect.arrayContaining(["posts", "events", "invites", "couple_members", "wishes", "moods", "ai_summaries", "wants", "albums", "couple_plans"]),
    );

    // 消す前に行が実在することを要求する。これが無いと、couple_id を持つ表が増えたときに
    // このテストがその表へ行を作らず、削除後の 0 件確認がもともと 0 件で通る（空振りの緑）
    for (const table of coupleIdTables) {
      const before = await db.prepare(`SELECT 1 FROM ${table} WHERE couple_id = ?1`).bind(couple.id).first();
      expect(
        before,
        `${table} にこのペアの行を作るテストデータがありません。このテストに追加してください`,
      ).not.toBeNull();
    }

    const result = await call(router.me.delete, undefined, { context: contextFor(owner) });
    expect(result.ok).toBe(true);

    for (const table of coupleIdTables) {
      const row = await db.prepare(`SELECT 1 FROM ${table} WHERE couple_id = ?1`).bind(couple.id).first();
      expect(row, `${table} にペアの行が残っています`).toBeNull();
    }
    // 記録は残る（057）
    const kept = await db.prepare("SELECT 1 FROM admin_actions WHERE couple_id = ?1").bind(couple.id).first();
    expect(kept, "admin_actions の記録が退会で消えている（残す決まり。057 0節 #10）").not.toBeNull();
  });

  // 上のテストは couple_id という列名に頼るので、その列を持たない表（reactions・post_images。
  // post_id で参照する側）が網に映らない。列名を足すと次の列名でまた漏れるので、列名ではなく
  // 「me.delete 後、登録の無い表は全部このテストの増分が 0 に戻る」で見る（032 3節）
  it("me.delete後、登録の無い全表が0件になる（列名ではなく表全体で見る）", async () => {
    // sqlite_% は SQLite の内部表（invite_failures が AUTOINCREMENT なので sqlite_sequence がある）。
    // d1_migrations・_cf_METADATA は D1 がクエリ自体を拒む（SQLITE_AUTH）。いずれもアプリの表では
    // ないので免除の一覧には入れない（入れると「これは消すべきなのか」と読む人が迷う）
    const { results: tables } = await db
      .prepare(
        `SELECT name AS name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations', '_cf_METADATA')`,
      )
      .all<{ name: string }>();
    const tableNames = tables.map((t) => t.name);

    // 検出の健全性（上の coupleIdTables と同じ形）
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "user",
        "session",
        "account",
        "verification",
        "invite_failures",
        "couples",
        "couple_members",
        "invites",
        "posts",
        "post_images",
        "reactions",
        "events",
        "wishes",
        "moods",
        "ai_summaries",
      ]),
    );

    // このファイルでは D1 の状態が it() をまたいで共有される（フルスイートでは他のテストが残した
    // couples の行が見える）。「DB にはこのペアしか居ない」前提は成り立たないので、このテストが
    // 増やした分が削除後にちょうど元へ戻ったか（件数の差分）で見る
    const baselineCounts = new Map<string, number>();
    for (const name of tableNames) {
      const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).first<{ c: number }>();
      baselineCounts.set(name, row?.c ?? 0);
    }

    const owner = await createUser();
    const couple = await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });

    // contextFor は session 行を経由しないので、この網に映すには手で行を作る
    // （自分の session が残っていたら落ちる、を確かめるため）
    const now = Math.floor(Date.now() / 1000);
    await db.batch([
      db
        .prepare(
          "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
        )
        .bind(crypto.randomUUID(), now + 3600, crypto.randomUUID(), now, owner.id),
      db
        .prepare(
          "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
        )
        .bind(crypto.randomUUID(), now + 3600, crypto.randomUUID(), now, partner.id),
    ]);

    const postImageId = await uploadTestPostImage(couple.id);
    const post = await call(
      router.post.create,
      { body: "テスト投稿", images: [{ imageId: postImageId, width: 100, height: 100 }] },
      { context: contextFor(owner) },
    );
    await call(router.reaction.toggle, { postId: post.id, kind: "heart" }, { context: contextFor(partner) });
    await call(
      router.event.create,
      { date: "2020-01-01", title: "予定", kind: "plan", repeatYearly: false, startTime: null, endTime: null, isShared: false },
      { context: contextFor(owner) },
    );
    await call(router.wish.create, { title: "テストの行きたい場所" }, { context: contextFor(owner) });
    // wants（040 T7）。画像は wants/ 接頭辞の R2 オブジェクトとして直接置く
    const wantImageId = generateImageId();
    await bucket.put(wantImageKeyFor(couple.id, wantImageId, "jpg"), new Uint8Array(100), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await call(router.want.create, { title: "テストのほしいもの", imageId: wantImageId }, { context: contextFor(owner) });
    // 相手の分も（owner_id が相手）
    await call(router.want.create, { title: "相手のほしいもの" }, { context: contextFor(partner) });
    // 041: albums / album_photos（album_photos は couple_id を持たない側。post_images と同じ扱い）
    const albumImageId = generateImageId();
    await bucket.put(albumImageKeyFor(couple.id, albumImageId), new Uint8Array(100), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await call(
      router.album.create,
      { title: "テストのアルバム", cover: { imageId: albumImageId, width: 100, height: 100 } },
      { context: contextFor(owner) },
    );
    await call(router.mood.setToday, { level: 5 }, { context: contextFor(owner) });
    // aiSummary.generate は本物の API を呼ぶので行を直接作る
    await db
      .prepare(
        `INSERT INTO ai_summaries (couple_id, period_kind, period_key, body, provider, model, generated_count, created_at, updated_at)
         VALUES (?1, 'month', '2026-01', 'テストのまとめ', 'openai', 'gpt-4o-mini', 1, ?2, ?2)`,
      )
      .bind(couple.id, now)
      .run();
    // couple_plans。運営の切り替え SQL と同じ文（045 T6）
    await db
      .prepare(
        "INSERT INTO couple_plans (couple_id, plan, source, updated_at) VALUES (?1, 'paid', 'manual', unixepoch()) ON CONFLICT(couple_id) DO UPDATE SET plan = 'paid', updated_at = unixepoch()",
      )
      .bind(couple.id)
      .run();

    // 免除は「表」ではなく「残ってよい行の条件」で書く（032 3節）。表ごと免除にすると、自分の
    // session が残っていても鳴らない（ログアウトされていないことを見逃す。T8・024 の再認証）。
    // ここに無い表は「このテストが増やした分がちょうど 0 へ戻ること」が既定
    const ALLOWED_TO_REMAIN: Record<string, string | null> = {
      user: "id <> ?1", // 相手のuser行は残る（Candle型。024）
      session: "user_id <> ?1", // 自分のsessionはCASCADEで消える。相手の分は残る
      account: "user_id <> ?1", // sessionと同じ理由
      verification: null, // Better Authの作業行。利用者に紐づかない
      invite_failures: null, // 消さないと決めた（PR #186。時間窓1時間で切れる）
      admin_actions: null, // 057: 運営の操作の記録。退会しても残す（0節 #10）
    };

    // 消す前チェック（空振りの緑を防ぐ）。couple_id を持つ表は既存の網と同じ、それ以外
    // （reactions・post_images 等）は baseline より増えていることだけを求める（032 4節）
    for (const name of tableNames) {
      if (name in ALLOWED_TO_REMAIN) continue;
      const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).first<{ c: number }>();
      const after = row?.c ?? 0;
      expect(
        after,
        `${name} にこのペアの行を作るテストデータがありません。このテストに追加してください`,
      ).toBeGreaterThan(baselineCounts.get(name) ?? 0);
    }

    const result = await call(router.me.delete, undefined, { context: contextFor(owner) });
    expect(result.ok).toBe(true);

    for (const name of tableNames) {
      if (name in ALLOWED_TO_REMAIN) {
        const allowed = ALLOWED_TO_REMAIN[name];
        if (allowed === null) continue; // 全部残ってよい表（verification・invite_failures）
        const row = await db.prepare(`SELECT 1 FROM ${name} WHERE NOT (${allowed})`).bind(owner.id).first();
        expect(row, `${name} に残ってはいけない行が残っています`).toBeNull();
      } else {
        const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).first<{ c: number }>();
        expect(
          row?.c ?? 0,
          `${name} にこのテストで作った行が残っています`,
        ).toBe(baselineCounts.get(name) ?? 0);
      }
    }
  });

  // 【受け入れている制約】reactions〜couples は db.batch() 1 本なので、me.delete の実行中に
  // couple_members だけ消えて couples が残る状態は起こらない。起こるのは me.delete の外側
  // （失敗した試行・バグ等）で couple_members が消えた場合だけ。resolveCoupleContext に削除専用の
  // 例外を作らない（conventions.md「守る相手のいない要件のために、認可の中心を触らない」）ので、
  // couple_members が無ければ coupleId を引けない。その挙動を固定する（変わったら判断を見直す）
  it("【受け入れている制約】me.deleteの外でcouple_membersが消えていると、couplesの行は孤児として残る", async () => {
    const owner = await createUser();
    const couple = await createCouple(owner);

    await db.prepare("DELETE FROM couple_members WHERE couple_id = ?1").bind(couple.id).run();

    // coupleId を引けないので couples の行は消せない（ユーザー自身は消える）
    const result = await call(router.me.delete, undefined, { context: contextFor(owner) });
    expect(result.ok).toBe(true);

    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(owner.id).first()).toBeNull();
    expect(await db.prepare("SELECT id FROM couples WHERE id = ?1").bind(couple.id).first()).not.toBeNull();
  });

  // me.delete の最悪のバグ（WHERE couple_id の欠落＝全ペア一括削除）を検知する。無関係な
  // 第2のペアのデータ・R2 オブジェクトが影響を受けないことを直接確かめる
  it("別のペアのデータ・R2オブジェクトは削除の影響を受けない", async () => {
    const owner = await createUser();
    const couple = await createCouple(owner);
    const postImageId = await uploadTestPostImage(couple.id);
    await call(
      router.post.create,
      { body: "消える投稿", images: [{ imageId: postImageId, width: 100, height: 100 }] },
      { context: contextFor(owner) },
    );

    const otherOwner = await createUser();
    const otherCouple = await createCouple(otherOwner);
    const otherImageId = await uploadTestPostImage(otherCouple.id);
    const otherPost = await call(
      router.post.create,
      { body: "残る投稿", images: [{ imageId: otherImageId, width: 100, height: 100 }] },
      { context: contextFor(otherOwner) },
    );

    await call(router.me.delete, undefined, { context: contextFor(owner) });

    expect(await db.prepare("SELECT id FROM couples WHERE id = ?1").bind(otherCouple.id).first()).not.toBeNull();
    expect(await db.prepare("SELECT id FROM posts WHERE id = ?1").bind(otherPost.id).first()).not.toBeNull();
    expect(await db.prepare("SELECT 1 FROM post_images WHERE post_id = ?1").bind(otherPost.id).first()).not.toBeNull();
    expect(await bucket.head(imageKeyFor(otherCouple.id, otherImageId))).not.toBeNull();
  });

  // デモペア（is_demo=1）は Google ログインの経路が塞がれていて現状は到達できないが、それを
  // seed の都合 1 つに頼らない。実在の認証ユーザーがデモペアに所属する組み合わせを直接作り、
  // 手続き自身の防御を確かめる
  it("is_demoのペアからは削除できない（手続き自身でも拒む）", async () => {
    const user = await createUser();
    const coupleId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await db.prepare("INSERT INTO couples (id, is_demo, created_at) VALUES (?1, 1, ?2)").bind(coupleId, now).run();
    await db
      .prepare("INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES (?1, ?2, 1, ?3)")
      .bind(coupleId, user.id, now)
      .run();

    await expect(call(router.me.delete, undefined, { context: contextFor(user) })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(await db.prepare("SELECT id FROM couples WHERE id = ?1").bind(coupleId).first()).not.toBeNull();
    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(user.id).first()).not.toBeNull();
  });

  // 相手のプロフィール画像は R2 から消すが、相手の user 行は残す（Candle 型）。me.ts 先頭の
  // 不変条件「image 列が非 NULL なら実体がある」を保つため、相手の image も NULL に戻す
  it("相手のプロフィール画像を消すと、相手のuser.imageもNULLに戻る", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
    const partner = await createUser();
    await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
    const partnerImageId = await uploadTestUserImage(partner.id);
    await call(router.me.update, { name: partner.name, imageId: partnerImageId }, { context: contextFor(partner) });

    await call(router.me.delete, undefined, { context: contextFor(owner) });

    const partnerRow = await db
      .prepare("SELECT image FROM user WHERE id = ?1")
      .bind(partner.id)
      .first<{ image: string | null }>();
    expect(partnerRow?.image).toBeNull();
  });

  it("userを削除するとsessionとaccountがON DELETE CASCADEで自動的に消える", async () => {
    const user = await createUser();
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
      )
      .bind(crypto.randomUUID(), now + 3600, crypto.randomUUID(), now, user.id)
      .run();
    await db
      .prepare(
        "INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
      )
      .bind(crypto.randomUUID(), "google", "google-sub-id", "google", user.id, now)
      .run();

    await call(router.me.delete, undefined, { context: contextFor(user) });

    expect(await db.prepare("SELECT id FROM session WHERE user_id = ?1").bind(user.id).first()).toBeNull();
    expect(await db.prepare("SELECT id FROM account WHERE user_id = ?1").bind(user.id).first()).toBeNull();
  });

  // invite_failures は user_id ではなく account_hash（Google アカウントの塩付きハッシュ）を持ち、
  // user への FK が無い。消さなくても user の削除は落ちないことを確かめる（024）
  it("invite_failuresはuserへのFKを持たない: 残っていてもme.deleteに影響しない", async () => {
    const user = await createUser();
    await db
      .prepare("INSERT INTO invite_failures (account_hash, ip_address, created_at) VALUES (?1, ?2, ?3)")
      .bind("dummy-account-hash", "203.0.113.1", Math.floor(Date.now() / 1000))
      .run();

    const result = await call(router.me.delete, undefined, { context: contextFor(user) });

    expect(result.ok).toBe(true);
    expect(
      await db.prepare("SELECT id FROM invite_failures WHERE account_hash = ?1").bind("dummy-account-hash").first(),
    ).not.toBeNull();
  });

  it("削除後、同じGoogleアカウントで登録し直しても前のペアに戻らない（新しいuser idになるため）", async () => {
    const owner = await createUser();
    await createCouple(owner);

    await call(router.me.delete, undefined, { context: contextFor(owner) });

    // account 行が無くなっているので、同じ Google アカウントでも新しい user.id で登録される
    // （024）。新しい user 行を作ってそれを模擬する
    const reregistered = await createUser();

    await expect(call(router.couple.get, undefined, { context: contextFor(reregistered) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
    expect(
      await db.prepare("SELECT 1 FROM couple_members WHERE user_id = ?1").bind(reregistered.id).first(),
    ).toBeNull();
  });

  // 不可逆で相手のデータまで消す操作なので、直近 5 分以内のサインインを要求する（024。
  // session.createdAt は動かない。context.ts 参照）。画面側が sessionIsFresh を見て先に弾くのが
  // 基本の経路だが、ここではサーバ側の最終防御を確かめる
  it("サインインから5分を超えているとREAUTH_REQUIRED", async () => {
    const user = await createUser();
    const staleSessionCreatedAt = Date.now() - REAUTH_WINDOW_MS - 1000;

    await expect(
      call(router.me.delete, undefined, { context: contextFor(user, { sessionCreatedAt: staleSessionCreatedAt }) }),
    ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });

    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(user.id).first()).not.toBeNull();
  });

  it("サインインから5分以内なら削除できる", async () => {
    const user = await createUser();
    const freshSessionCreatedAt = Date.now() - REAUTH_WINDOW_MS + 1000;

    const result = await call(router.me.delete, undefined, {
      context: contextFor(user, { sessionCreatedAt: freshSessionCreatedAt }),
    });

    expect(result.ok).toBe(true);
  });
});

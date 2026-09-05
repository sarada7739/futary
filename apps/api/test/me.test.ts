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
import { imageKeyFor, userImageKeyFor } from "../src/lib/r2-signed-url";
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
    // invite.acceptがaccount_id（Googleの識別子）を引く（024）。このファイルは
    // ペア成立にinvite.acceptを使うため、account行が無いと失敗する
    db
      .prepare(
        "INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at) VALUES (?1, 'google', ?2, 'google', ?3, ?4, ?4)",
      )
      .bind(crypto.randomUUID(), `google-sub-${id}`, id, now),
  ]);
  return { id, name, email };
}

// 024: me.deleteの再認証チェック（sessionIsFresh）をテストするため、
// sessionCreatedAtを上書きできるようにする。省略時は「たった今サインインした」
// ことにする（既定の経路が邪魔をしない）
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

// me.uploadImageUrl を経由せず R2 に直接オブジェクトを置く。「アップロード済み」を
// 模擬する（post.test.ts の uploadTestImage と同じ形）
async function uploadTestUserImage(userId: string, sizeBytes = 100, contentType = "image/jpeg"): Promise<string> {
  const imageId = generateImageId();
  await bucket.put(userImageKeyFor(userId, imageId), new Uint8Array(sizeBytes), {
    httpMetadata: { contentType },
  });
  return imageId;
}

// 024: me.delete のテストで使う。post.test.ts / event.test.ts / invite.test.ts と同じ形
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

  // 024・Aの決定: 削除確認画面に入れるかの判定はサーバが真偽値で返す
  // （時刻を返してクライアントに比べさせない。event.tsのcanEditと同じ理由）
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

  // 037: ペア未所属ならcouple_membersに行が無いため、両方false
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

  // couple_membersに行が無いと更新対象が無いため、writeProcedureが
  // NEEDS_ONBOARDINGで弾く
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

// 024: アカウント削除と退会
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
    // 027・security-auditor指摘: wishes.couple_idもcouples(id)を参照するため、
    // これを消さずにcouplesを消そうとするとFK違反でbatch全体が失敗し、
    // アカウント削除が恒久的にできなくなる不具合があった（修正済み）
    await call(router.wish.create, { title: "テストの行きたい場所" }, { context: contextFor(owner) });
    // 029: moods.couple_idも同じ理由でcouplesを参照する
    await call(router.mood.setToday, { level: 5 }, { context: contextFor(owner) });
    // 037: ai_summaries.couple_idも同じ理由でcouplesを参照する。
    // aiSummary.generateは本物のAPIを呼ぶため使わず、行を直接作る
    // （タスク定義「テストで本物のAPIを叩かない」）
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
    // 031: post_imagesはcouple_id列を持たない（postsをpost_idで参照する側）
    // ため、下の機械的走査には拾われない。reactionsと同じ理由で手で確認する
    expect(await db.prepare("SELECT 1 FROM post_images WHERE post_id = ?1").bind(post.id).first()).toBeNull();
    expect(await db.prepare("SELECT id FROM events WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT code FROM invites WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT id FROM wishes WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM moods WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM ai_summaries WHERE couple_id = ?1").bind(couple.id).first()).toBeNull();

    // 自分のuser行は消え、相手のuser行はCandle型として残る（消えるのはペアのデータだけ）
    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(owner.id).first()).toBeNull();
    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(partner.id).first()).not.toBeNull();

    // R2: 投稿画像・プロフィール画像（2人分）が消える
    expect(await bucket.head(imageKeyFor(couple.id, postImageId))).toBeNull();
    expect(await bucket.head(userImageKeyFor(owner.id, ownerImageId))).toBeNull();
    expect(await bucket.head(userImageKeyFor(partner.id, partnerImageId))).toBeNull();

    // 相手もどの手続きからもペアのデータを読めなくなる
    await expect(call(router.couple.get, undefined, { context: contextFor(partner) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  // 024タスク定義「couple_membersを消した時点で、両方の利用者がどの手続きからも
  // ペアのデータを読めない（残りの行が残っている状態で）」。手続きの途中の
  // 状態を直接作るため、実際の削除手順（1〜5）をSQLで直接再現する
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

    // couplesの行はまだ残っている（読めなくなることの証明であり、
    // 消えていることの証明ではない）
    expect(await db.prepare("SELECT id FROM couples WHERE id = ?1").bind(couple.id).first()).not.toBeNull();

    await expect(call(router.couple.get, undefined, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
    await expect(call(router.couple.get, undefined, { context: contextFor(partner) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  // 024タスク定義「途中で止めて再実行しても、同じ結果になる（各段で1回止めて
  // 再開する）」。
  // 【security-auditor指摘で訂正】reactions〜couples（手順1〜6）は
  // db.batch()1本にまとめてある（下のmeDeleteのコメント参照。並行書き込みが
  // 途中に着地して回収不能な孤児が残る、という指摘を受けての変更）ため、
  // このテストが元々シミュレートしていた「途中経過」は、実際にはme.delete
  // 自身の実行中には起こり得ない。ここでは「一部の行が既に無い状態で
  // me.deleteを呼んでも、残りを正しく片付けて完走する」という、
  // batch()のWHERE句の冪等性そのものを確認する形として残す（例えば
  // 過去の失敗した試行やバグで一部だけ消えていた場合の後始末を担保する）
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

  // 【security-auditor指摘・027】027でwishesを足した際、me.deleteのbatchに
  // 削除文を足し忘れ、wishを1件でも持つペアはDELETE FROM couples実行時に
  // FK違反で恒久的に削除が失敗する不具合があった（修正済み）。手で表の
  // 一覧を並べたテストだけでは「次の表」で同じ漏れ方をするため、
  // couple_id列を持つ表をsqlite_masterから機械的に検出し、その全表で
  // me.delete後にペアの行が0件であることを確認する（authorization.test.tsの
  // collectProcedures走査・viewer-key-coverage.test.tsのfindReadScopedProcedures
  // と同じ「手で維持する一覧に頼らない」考え方）
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
    // 029: moodsもcouple_idを持つ表として、この機械的走査に自動的に拾われる
    await call(router.mood.setToday, { level: 3 }, { context: contextFor(owner) });
    // 037: ai_summariesも同じ理由でこの機械的走査に自動的に拾われる。
    // aiSummary.generateは本物のAPIを呼ぶため使わず、行を直接作る
    await db
      .prepare(
        `INSERT INTO ai_summaries (couple_id, period_kind, period_key, body, provider, model, generated_count, created_at, updated_at)
         VALUES (?1, 'month', '2026-01', 'テストのまとめ', 'openai', 'gpt-4o-mini', 1, ?2, ?2)`,
      )
      .bind(couple.id, Math.floor(Date.now() / 1000))
      .run();

    // D1はPRAGMA文を許可しない（SQLITE_AUTH。実測で確認）ため、
    // schema-integrity.test.tsのextractNamedChecksと同じ方式で、
    // sqlite_masterのCREATE TABLE文字列から列名を直接拾う
    const { results: tables } = await db
      .prepare(`SELECT name AS name, sql AS sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'couples'`)
      .all<{ name: string; sql: string }>();

    // 【Rレビュー指摘】バッククォート必須（`couple_id`）だと、手書きの
    // マイグレーションでバッククォート無しに書かれた表を静かに見逃す。
    // 緩めても誤検知は増えない（couple_idを含むのに実際は
    // `WHERE couple_id = ?`が通らない表があれば、下のbeforeチェックで
    // 例外として落ちる。fail-closed）
    const coupleIdTables = tables.filter((t) => /couple_id/.test(t.sql)).map((t) => t.name);

    // 検出ロジック自体の健全性: 既知の表が最低限含まれていることを保証する
    // （0件だと下のループが何もチェックせず成功してしまう）
    expect(coupleIdTables).toEqual(
      expect.arrayContaining(["posts", "events", "invites", "couple_members", "wishes", "moods", "ai_summaries"]),
    );

    // 【Rレビュー指摘R-1】削除前チェックが無いと、将来「couple_idを持つ新しい表」
    // が増えたときにこのテストがその表へ行を作らないため、削除後の0件確認が
    // 常に（もともと0件で）通ってしまい、削除文を足し忘れても検知できない
    // 「空振りの緑」になる。viewer-key-coverage.test.tsのtotalMatches>0と
    // 同じ形で、消す前に行が実在することを要求する
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
  });

  // 【032】上のテストは`couple_id`という列名に頼っているため、その列を
  // 持たない表（`reactions`・`post_images`。ともに`post_id`で参照する側）が
  // 網に映らない。031のレビューで実際にこの2つが漏れていた（R指摘）。
  // 「`post_id`も見る」に足すと次の列名でまた漏れる（列名を並べる一覧に
  // 戻ってしまう）ため、列名ではなく「me.delete後、登録の無い表は全部
  // 0件」に変える。テストのDBにはこのペアのデータしか無いため、joinの経路を
  // 辿らずに「0件かどうか」だけを見れば足りる（032タスク定義3節）
  it("me.delete後、登録の無い全表が0件になる（列名ではなく表全体で見る）", async () => {
    // `sqlite_%`はSQLiteの内部表（032タスク定義3節。`invite_failures`が
    // AUTOINCREMENTのため`sqlite_sequence`が存在する）。`d1_migrations`
    // （drizzle-kitのマイグレーション適用記録）・`_cf_METADATA`（D1が内部で
    // 使う表）はアプリの表ではなく、D1がクエリ自体を拒む
    // （実行して確認: `SQLITE_AUTH: not authorized`）。いずれも免除の
    // 一覧には入れない。アプリの表ではないものをアプリの判断として登録すると、
    // 次に読む人が「これは消すべきなのか」と考える
    const { results: tables } = await db
      .prepare(
        `SELECT name AS name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations', '_cf_METADATA')`,
      )
      .all<{ name: string }>();
    const tableNames = tables.map((t) => t.name);

    // 検出ロジック自体の健全性（上のcoupleIdTablesの健全性チェックと同じ形）
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

    // 【実測して分かったこと】このテストファイルはD1の状態がit()をまたいで
    // 共有されている。「isolated per-test storage」を謳うプラグインだが、
    // このテスト単体では通り、フルスイートで実行すると`couples`に他の
    // テストが残した行が既に1件見える（`SELECT COUNT(*) FROM couples`を
    // このテストの先頭で実行して確認した）。よって「削除後は0件」という
    // 032タスク定義3節の前提（「DBにはこのペアしか居ない」）は、この
    // テストファイル内では成立しない。「このテストが増やした分が、
    // 削除後にちょうど元へ戻ったか」（件数の差分）で見る。件数だけを見る
    // ため、他のテストが残した行の中身を読む必要はない
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

    // sessionはBetter Authの実テーブルだが、contextForは実際の行を経由せず
    // RpcContextを直接組み立てているため、この網に映すには手で行を作る
    // （自分のsessionが残っていたら落ちる、を証明するために必要。下記）
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
    await call(router.mood.setToday, { level: 5 }, { context: contextFor(owner) });
    // 037: aiSummary.generateは本物のAPIを呼ぶため使わず、行を直接作る
    await db
      .prepare(
        `INSERT INTO ai_summaries (couple_id, period_kind, period_key, body, provider, model, generated_count, created_at, updated_at)
         VALUES (?1, 'month', '2026-01', 'テストのまとめ', 'openai', 'gpt-4o-mini', 1, ?2, ?2)`,
      )
      .bind(couple.id, now)
      .run();

    // 免除は「表」ではなく「残ってよい行の条件」で登録する（Rレビュー指摘。
    // 032タスク定義3節）。表ごと免除にすると、自分のsessionが残っていても
    // 鳴らない（ログアウトされていないことを見逃す。T8・024の再認証に直結）。
    // ここに無い表は「このテストが増やした分がちょうど0へ戻ること」が既定
    // （下のループ参照）。値はB自身が1ペア・2人で実測して確かめた
    // （`couples`はこのテストの増分がちょうど0へ戻った）
    const ALLOWED_TO_REMAIN: Record<string, string | null> = {
      user: "id <> ?1", // 相手のuser行は残る（Candle型。024）
      session: "user_id <> ?1", // 自分のsessionはCASCADEで消える。相手の分は残る
      account: "user_id <> ?1", // sessionと同じ理由
      verification: null, // Better Authの作業行。利用者に紐づかない
      invite_failures: null, // 消さないと決めた（PR #186。時間窓1時間で切れる）
    };

    // 消す前チェック（空振りの緑を防ぐ）。couple_id列を持つ表は既存の網と
    // 同じ考え方、それ以外（reactions・post_images等）は「baselineより
    // 増えていること」だけを要求する（032タスク定義4節。どのペアの行かを
    // 判定しなくてよい。このテストが作った分の増減だけを見る）
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

  // 【記録: 受け入れている制約。security-auditor指摘を受けて範囲を訂正】
  // reactions〜couplesはdb.batch()1本にまとめたため（下のmeDeleteのコメント
  // 参照）、me.delete自身の実行中にcouple_membersだけが消えてcouplesが
  // 残る、という中間状態はもう起こらない。この状態が起こりうるのは、
  // このテストのようにme.deleteの外側（別の失敗した試行・バグ等）で
  // couple_membersが消えた場合だけである。resolveCoupleContextに削除専用の
  // 例外を作らないと決めた（conventions.md「守る相手のいない要件のために、
  // 認可の中心を触らない」）以上、couple_membersが無ければcoupleIdを
  // 引く手段が無い、という制約自体は変わらないため、その挙動をそのまま
  // 固定する（挙動が変わったら、この判断自体を見直す必要がある）
  it("【受け入れている制約】me.deleteの外でcouple_membersが消えていると、couplesの行は孤児として残る", async () => {
    const owner = await createUser();
    const couple = await createCouple(owner);

    await db.prepare("DELETE FROM couple_members WHERE couple_id = ?1").bind(couple.id).run();

    // この時点でme.deleteを呼んでも、coupleIdを引けないため
    // couplesの行を消せない（ユーザー自身は消える）
    const result = await call(router.me.delete, undefined, { context: contextFor(owner) });
    expect(result.ok).toBe(true);

    expect(await db.prepare("SELECT id FROM user WHERE id = ?1").bind(owner.id).first()).toBeNull();
    expect(await db.prepare("SELECT id FROM couples WHERE id = ?1").bind(couple.id).first()).not.toBeNull();
  });

  // 【security-auditor指摘】me.deleteが起こしうる最悪のバグ（WHERE couple_id
  // の欠落＝全ペア一括削除）を検知するテストが無かった。無関係な第2の
  // ペアのデータ・R2オブジェクトが影響を受けないことを直接確認する
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

  // 【security-auditor指摘】デモペア（is_demo=1）はGoogleログイン経路が
  // 塞がれているため現状は到達不能（seed.tsのemail_verified=0・
  // @example.com判定）だが、その到達不能性がseedの都合1つに依存する
  // 状態にしない。ここでは実際には起こりえない組み合わせ
  // （実在の認証ユーザーがデモペアに所属している）を直接作って、
  // 手続き自身の防御を確認する
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

  // 【security-auditor指摘】相手のプロフィール画像はR2から消すが、相手の
  // user行は残す（Candle型）。me.ts先頭の不変条件「image列が非NULLなら
  // 実体がある」を保つため、相手のimageもNULLへ戻す
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

  // 【Aの決定・024で訂正】以前はinvite_failures.user_idがuserへのFKで、
  // 消す順序を証明するテストがここにあった。account_hash（Googleアカウントの
  // 塩付きハッシュ）に差し替えてFK自体を無くしたため、消さなくてもuserの
  // 削除は落ちない。この逆（FKが無くなったこと）を直接確かめる
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

    // Better Authは account 行が無くなっているため、同じGoogleアカウントでも
    // 新しいuser.idで登録する（024タスク定義）。ここでは新しいuser行を
    // 作ることでそれを模擬する
    const reregistered = await createUser();

    await expect(call(router.couple.get, undefined, { context: contextFor(reregistered) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
    expect(
      await db.prepare("SELECT 1 FROM couple_members WHERE user_id = ?1").bind(reregistered.id).first(),
    ).toBeNull();
  });

  // 024・Aの決定: 不可逆で相手のデータまで消す操作のため、直近5分以内の
  // サインインを要求する（session.createdAtが動かないことをBetter Auth本体の
  // ソースで確認済み。context.tsのコメント参照）。画面側（delete-account.tsx）が
  // me.get().sessionIsFreshを見て確認フローに入る前に弾くのが基本経路だが、
  // ここではサーバ側の最終防御そのものを確認する
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

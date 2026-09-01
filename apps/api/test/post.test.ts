import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import { imageKeyFor, MAX_IMAGE_BYTES } from "../src/lib/r2-signed-url";
import { generateImageId } from "../src/lib/ulid";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

// 実際の R2 API トークン（.dev.vars の R2_ACCOUNT_ID 等）の設定有無に
// テストの合否が左右されないよう、署名鍵はテスト固有の固定値を使う。
// 署名の生成自体はネットワークを伴わない計算のため、実在のキーでなくても動く
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

function contextFor(
  user: { id: string; name: string; email: string } | null,
  demoCoupleId: string | null = null,
): RpcContext {
  return {
    db,
    bucket,
    r2Sign,
    user: user ? { ...user, image: null } : null,
    ip: "203.0.113.1",
    demoCoupleId,
    sessionCreatedAt: user ? new Date() : null,
    authSecret: "test-secret",
  };
}

async function createCouple(user: { id: string; name: string; email: string }) {
  return call(router.couple.create, {}, { context: contextFor(user) });
}

// created_at を直接指定して投稿を作る（同一秒の重複・欠落テストのため、
// post.create の now() 依存を避けて直接DBへ挿入する）
async function insertPost(coupleId: string, authorId: string, createdAt: number, body = "テスト投稿"): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(id, coupleId, authorId, body, createdAt)
    .run();
  return id;
}

// post.uploadUrl を経由せず R2 に直接オブジェクトを置く。「アップロード済み」を模擬する。
// post.create は Content-Type も検証する（007 security-auditor 指摘）ため、
// 正規のアップロードと同じ image/jpeg を付与する
async function uploadTestImage(coupleId: string, sizeBytes = 100, contentType = "image/jpeg"): Promise<string> {
  const imageId = generateImageId();
  await bucket.put(imageKeyFor(coupleId, imageId), new Uint8Array(sizeBytes), {
    httpMetadata: { contentType },
  });
  return imageId;
}

describe("post.create", () => {
  it("認証済みメンバーが投稿を作成できる", async () => {
    const user = await createUser();
    await createCouple(user);

    const post = await call(router.post.create, { body: "こんにちは" }, { context: contextFor(user) });

    expect(post.body).toBe("こんにちは");
    expect(post.authorId).toBe(user.id);
    expect(post.imageUrl).toBeNull();
  });

  it("アップロード済みの imageId を指定すると画像付きで保存され、署名付きURLが返る", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const imageId = await uploadTestImage(couple.id);

    const post = await call(
      router.post.create,
      { body: "写真つき", imageId, imageWidth: 800, imageHeight: 600 },
      { context: contextFor(user) },
    );

    expect(post.imageUrl).not.toBeNull();
    expect(post.imageWidth).toBe(800);
    expect(post.imageHeight).toBe(600);
  });

  it("本文が空でも画像があれば作成できる", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const imageId = await uploadTestImage(couple.id);

    const post = await call(router.post.create, { body: "", imageId }, { context: contextFor(user) });
    expect(post.imageUrl).not.toBeNull();
  });

  it("本文と画像がどちらも空だと INVALID_INPUT（旧L30）", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.post.create, { body: "" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("本文が空白のみだと画像が無ければ INVALID_INPUT（空白のみも空として扱う）", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.post.create, { body: "   " }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("未アップロードの imageId を指定すると INVALID_INPUT（R2に実体が無い）", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(
        router.post.create,
        { body: "", imageId: generateImageId() },
        { context: contextFor(user) },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("imageId が ULID の形式でない場合は入力バリデーションで弾かれる（007 security-auditor 指摘）", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(
        router.post.create,
        { body: "", imageId: "../../other-couple/posts/x" },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  it("同じ imageId を2つの投稿で使うと2回目は INVALID_INPUT（UNIQUE制約）", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const imageId = await uploadTestImage(couple.id);

    await call(router.post.create, { body: "1件目", imageId }, { context: contextFor(user) });

    await expect(
      call(router.post.create, { body: "2件目", imageId }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("サイズ上限を超える画像は INVALID_INPUT になり、R2からも削除される", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const imageId = await uploadTestImage(couple.id, MAX_IMAGE_BYTES + 1);
    const key = imageKeyFor(couple.id, imageId);

    await expect(
      call(router.post.create, { body: "", imageId }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    expect(await bucket.head(key)).toBeNull();
  });

  it("Content-Type が image/jpeg 以外の実体は INVALID_INPUT になり、R2からも削除される（007 security-auditor 指摘）", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const imageId = await uploadTestImage(couple.id, 100, "image/png");
    const key = imageKeyFor(couple.id, imageId);

    await expect(
      call(router.post.create, { body: "", imageId }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    expect(await bucket.head(key)).toBeNull();
  });

  it("他ペアが置いた imageId を送っても、鍵が ctx.coupleId で組み立てられるため存在しないオブジェクトを指すだけになり INVALID_INPUT（他ペアの画像に到達しない）", async () => {
    const userA = await createUser();
    const coupleA = await createCouple(userA);
    const userB = await createUser();
    const coupleB = await createCouple(userB);
    const imageIdOfB = await uploadTestImage(coupleB.id);

    await expect(
      call(router.post.create, { body: "", imageId: imageIdOfB }, { context: contextFor(userA) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    // Bの実体自体は無事（Aの操作でBのオブジェクトが消えたりしない）
    expect(await bucket.head(imageKeyFor(coupleB.id, imageIdOfB))).not.toBeNull();
    // coupleA 側には何も作られていない
    expect(await bucket.head(imageKeyFor(coupleA.id, imageIdOfB))).toBeNull();
  });

  it("本文が2000文字を超えると入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.post.create, { body: "あ".repeat(2001) }, { context: contextFor(user) }),
    ).rejects.toThrow();
  });

  it("本文がちょうど2000文字なら作成できる", async () => {
    const user = await createUser();
    await createCouple(user);

    const post = await call(router.post.create, { body: "あ".repeat(2000) }, { context: contextFor(user) });
    expect(post.body).toHaveLength(2000);
  });

  it("未認証なら FORBIDDEN", async () => {
    await expect(
      call(router.post.create, { body: "こんにちは" }, { context: contextFor(null) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ペアに未所属なら NEEDS_ONBOARDING", async () => {
    const user = await createUser();
    await expect(
      call(router.post.create, { body: "こんにちは" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });
});

describe("post.list", () => {
  it("削除されていない自分のペアの投稿だけを新しい順に返す", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const now = Math.floor(Date.now() / 1000);
    await insertPost(couple.id, user.id, now - 30, "1件目");
    await insertPost(couple.id, user.id, now - 20, "2件目");
    await insertPost(couple.id, user.id, now - 10, "3件目");

    const result = await call(router.post.list, {}, { context: contextFor(user) });

    expect(result.items.map((p) => p.body)).toEqual(["3件目", "2件目", "1件目"]);
    expect(result.nextCursor).toBeNull();
  });

  it("論理削除された投稿は一覧に出ない", async () => {
    const user = await createUser();
    await createCouple(user);
    const post = await call(router.post.create, { body: "消される投稿" }, { context: contextFor(user) });
    await call(router.post.create, { body: "残る投稿" }, { context: contextFor(user) });

    await call(router.post.delete, { id: post.id }, { context: contextFor(user) });

    const result = await call(router.post.list, {}, { context: contextFor(user) });
    expect(result.items.map((p) => p.id)).not.toContain(post.id);
    expect(result.items).toHaveLength(1);
  });

  it("他ペアの投稿は一覧に混ざらない", async () => {
    const userA = await createUser();
    const coupleA = await createCouple(userA);
    await insertPost(coupleA.id, userA.id, Math.floor(Date.now() / 1000), "Aの投稿");

    const userB = await createUser();
    const coupleB = await createCouple(userB);
    await insertPost(coupleB.id, userB.id, Math.floor(Date.now() / 1000), "Bの投稿");

    const result = await call(router.post.list, {}, { context: contextFor(userA) });
    expect(result.items.map((p) => p.body)).toEqual(["Aの投稿"]);
  });

  // 完了条件: 同一秒に3件投稿してもページングで重複・欠落しない。
  // 20件目/21件目の境界に同一 created_at のタイ集団をまたがせ、複合カーソル
  // （created_at, id）が境界を正しく割ることを検証する
  it("ページ境界に同一秒の投稿が重複しても、全ページを辿ると重複・欠落しない", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const base = Math.floor(Date.now() / 1000);
    const ids: string[] = [];

    // 直近19件は created_at がすべて異なる（1〜19位）
    for (let i = 0; i < 19; i++) {
      ids.push(await insertPost(couple.id, user.id, base - i));
    }
    // 20〜22位を同一秒にする（1ページ目=20件の境界をまたぐ）
    const tieAt = base - 1000;
    const tieIds = [
      await insertPost(couple.id, user.id, tieAt, "同一秒A"),
      await insertPost(couple.id, user.id, tieAt, "同一秒B"),
      await insertPost(couple.id, user.id, tieAt, "同一秒C"),
    ];
    ids.push(...tieIds);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 5; guard++) {
      const page = await call(router.post.list, { cursor }, { context: contextFor(user) });
      seen.push(...page.items.map((p) => p.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(22);
    expect(new Set(seen).size).toBe(22);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  it("壊れた cursor は INVALID_INPUT になる", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.post.list, { cursor: "not-a-valid-cursor" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("ペアに未所属なら NEEDS_ONBOARDING", async () => {
    const user = await createUser();
    await expect(call(router.post.list, {}, { context: contextFor(user) })).rejects.toMatchObject({
      code: "NEEDS_ONBOARDING",
    });
  });

  it("画像付きの投稿は署名付きGET URLを含む", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const imageId = await uploadTestImage(couple.id);
    await call(router.post.create, { body: "", imageId }, { context: contextFor(user) });

    const result = await call(router.post.list, {}, { context: contextFor(user) });
    expect(result.items[0]?.imageUrl).not.toBeNull();
  });

  // 008・architecture.md 5節: 投稿カードの投稿者名・アバターのため
  it("投稿者の名前・アバターを含む", async () => {
    const user = await createUser();
    await createCouple(user);
    await call(router.post.create, { body: "こんにちは" }, { context: contextFor(user) });

    const result = await call(router.post.list, {}, { context: contextFor(user) });
    expect(result.items[0]?.authorName).toBe(user.name);
    // contextFor は image: null を積むテスト用ヘルパーのため null が正しい
    expect(result.items[0]?.authorImage).toBeNull();
  });

  // 「user 行が無くても投稿が落ちない」テストはここに置かない。
  // posts.author_id は user への FK を持ち、その状態はクライアント可観測な
  // 操作からは構築できない（到達不能）。設計上の理由は architecture.md 5節、
  // 経緯は state.md L37 参照
});

describe("post.delete", () => {
  it("自分のペアの投稿を論理削除できる（deleted_at が立ち、一覧から消える）", async () => {
    const user = await createUser();
    await createCouple(user);
    const post = await call(router.post.create, { body: "削除対象" }, { context: contextFor(user) });

    const result = await call(router.post.delete, { id: post.id }, { context: contextFor(user) });
    expect(result.id).toBe(post.id);

    const row = await db
      .prepare("SELECT deleted_at FROM posts WHERE id = ?1")
      .bind(post.id)
      .first<{ deleted_at: number | null }>();
    expect(row?.deleted_at).not.toBeNull();
  });

  it("他ペアの投稿IDを指定すると NOT_FOUND になり、対象は削除されない（005の認可テストと同じ形）", async () => {
    const userA = await createUser();
    await createCouple(userA);
    const postA = await call(router.post.create, { body: "Aの投稿" }, { context: contextFor(userA) });

    const userB = await createUser();
    await createCouple(userB);

    await expect(call(router.post.delete, { id: postA.id }, { context: contextFor(userB) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const row = await db
      .prepare("SELECT deleted_at FROM posts WHERE id = ?1")
      .bind(postA.id)
      .first<{ deleted_at: number | null }>();
    expect(row?.deleted_at).toBeNull();
  });

  it("存在しないIDは NOT_FOUND", async () => {
    const user = await createUser();
    await createCouple(user);
    await expect(
      call(router.post.delete, { id: crypto.randomUUID() }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("既に削除済みの投稿を再度削除すると NOT_FOUND", async () => {
    const user = await createUser();
    await createCouple(user);
    const post = await call(router.post.create, { body: "二重削除テスト" }, { context: contextFor(user) });
    await call(router.post.delete, { id: post.id }, { context: contextFor(user) });

    await expect(
      call(router.post.delete, { id: post.id }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("未認証なら FORBIDDEN", async () => {
    await expect(
      call(router.post.delete, { id: crypto.randomUUID() }, { context: contextFor(null) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ペアに未所属なら NEEDS_ONBOARDING", async () => {
    const user = await createUser();
    await expect(
      call(router.post.delete, { id: crypto.randomUUID() }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });

  it("画像付きの投稿を削除すると R2 からもオブジェクトが消え、image_key は DB に残る", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const imageId = await uploadTestImage(couple.id);
    const key = imageKeyFor(couple.id, imageId);
    const post = await call(router.post.create, { body: "", imageId }, { context: contextFor(user) });

    await call(router.post.delete, { id: post.id }, { context: contextFor(user) });

    expect(await bucket.head(key)).toBeNull();
    const row = await db
      .prepare("SELECT image_key FROM posts WHERE id = ?1")
      .bind(post.id)
      .first<{ image_key: string | null }>();
    expect(row?.image_key).toBe(key);
  });

  it("R2の削除に失敗しても post.delete は成功として返る（image_key は残る）", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const imageId = await uploadTestImage(couple.id);
    const key = imageKeyFor(couple.id, imageId);
    const post = await call(router.post.create, { body: "", imageId }, { context: contextFor(user) });

    const failingBucket = {
      ...bucket,
      delete: () => Promise.reject(new Error("R2削除失敗（テスト用）")),
    } as unknown as R2Bucket;

    const result = await call(router.post.delete, { id: post.id }, { context: { ...contextFor(user), bucket: failingBucket } });
    expect(result.id).toBe(post.id);

    // 実際には削除を試みていない（failingBucket）ため実体は残っている。
    // image_key が DB から消されていないことのほうが本題
    const row = await db
      .prepare("SELECT image_key, deleted_at FROM posts WHERE id = ?1")
      .bind(post.id)
      .first<{ image_key: string | null; deleted_at: number | null }>();
    expect(row?.image_key).toBe(key);
    expect(row?.deleted_at).not.toBeNull();
  });
});

describe("post.uploadUrl", () => {
  it("認証済みメンバーが呼べる。imageId はサーバが生成し、鍵は ctx.coupleId から組み立てられる", async () => {
    const user = await createUser();
    const couple = await createCouple(user);

    const result = await call(
      router.post.uploadUrl,
      { contentType: "image/jpeg" },
      { context: contextFor(user) },
    );

    expect(result.imageId).toBeTruthy();
    expect(result.url).toContain(`couples/${couple.id}/posts/${result.imageId}.jpg`);
  });

  it("呼ぶたびに異なる imageId が発行される", async () => {
    const user = await createUser();
    await createCouple(user);

    const first = await call(router.post.uploadUrl, { contentType: "image/jpeg" }, { context: contextFor(user) });
    const second = await call(router.post.uploadUrl, { contentType: "image/jpeg" }, { context: contextFor(user) });

    expect(first.imageId).not.toBe(second.imageId);
  });

  it("image/jpeg 以外の contentType は入力バリデーションで弾かれる", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      // @ts-expect-error 契約は "image/jpeg" 固定（z.literal）。不正な値をわざと渡す
      call(router.post.uploadUrl, { contentType: "image/png" }, { context: contextFor(user) }),
    ).rejects.toThrow();
  });

  it("未認証なら FORBIDDEN（デモから呼べない）", async () => {
    await expect(
      call(router.post.uploadUrl, { contentType: "image/jpeg" }, { context: contextFor(null) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ペアに未所属なら NEEDS_ONBOARDING", async () => {
    const user = await createUser();
    await expect(
      call(router.post.uploadUrl, { contentType: "image/jpeg" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "NEEDS_ONBOARDING" });
  });
});

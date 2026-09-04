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
    sessionCreatedAt: user ? Date.now() : null,
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

// 031: post.create の images 入力を組み立てる。widthsの長さぶん、
// アップロード済みのimageIdを発行して並べる
async function uploadTestImages(
  coupleId: string,
  widths: number[],
): Promise<Array<{ imageId: string; width: number; height: number }>> {
  const images = [];
  for (const width of widths) {
    const imageId = await uploadTestImage(coupleId);
    images.push({ imageId, width, height: Math.round(width * 0.75) });
  }
  return images;
}

describe("post.create", () => {
  it("認証済みメンバーが投稿を作成できる", async () => {
    const user = await createUser();
    await createCouple(user);

    const post = await call(router.post.create, { body: "こんにちは" }, { context: contextFor(user) });

    expect(post.body).toBe("こんにちは");
    expect(post.authorId).toBe(user.id);
    expect(post.images).toEqual([]);
  });

  it("アップロード済みの imageId を指定すると画像付きで保存され、署名付きURLが返る", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const images = await uploadTestImages(couple.id, [800]);

    const post = await call(
      router.post.create,
      { body: "写真つき", images },
      { context: contextFor(user) },
    );

    expect(post.images).toHaveLength(1);
    expect(post.images[0]?.url).not.toBeNull();
    expect(post.images[0]?.width).toBe(800);
    expect(post.images[0]?.height).toBe(600);
  });

  // 031: 1投稿に画像を4枚まで。並び順は渡した順（position 0..3）のまま返る
  it("複数枚（4枚）を指定すると、渡した順に position 0..3 で保存され、その順で返る", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const images = await uploadTestImages(couple.id, [100, 200, 300, 400]);

    const post = await call(router.post.create, { body: "4枚", images }, { context: contextFor(user) });

    expect(post.images.map((i) => i.width)).toEqual([100, 200, 300, 400]);

    const rows = await db
      .prepare("SELECT position AS position, width AS width FROM post_images WHERE post_id = ?1 ORDER BY position")
      .bind(post.id)
      .all<{ position: number; width: number }>();
    expect(rows.results.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    expect(rows.results.map((r) => r.width)).toEqual([100, 200, 300, 400]);
  });

  it("5枚渡すと拒まれる（Zodのmax(4)。BAD_REQUEST。conventions.md 5節）", async () => {
    const user = await createUser();
    await createCouple(user);
    // 実体をR2に置く必要はない。枚数の検証は実体確認より前（入力スキーマ）で効く
    const images = Array.from({ length: 5 }, () => ({
      imageId: generateImageId(),
      width: 100,
      height: 100,
    }));

    await expect(
      call(router.post.create, { body: "5枚", images }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("本文が空でも画像があれば作成できる", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const images = await uploadTestImages(couple.id, [800]);

    const post = await call(router.post.create, { body: "", images }, { context: contextFor(user) });
    expect(post.images).toHaveLength(1);
  });

  it("本文と画像がどちらも空だと INVALID_INPUT（旧L30）", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.post.create, { body: "" }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  // 031タスク定義5節「imagesが空配列のときは、無いものとして扱う（undefinedと分けない）」
  it("imagesが空配列でも、本文が空なら省略時と同じくINVALID_INPUT", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(router.post.create, { body: "", images: [] }, { context: contextFor(user) }),
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
        { body: "", images: [{ imageId: generateImageId(), width: 100, height: 100 }] },
        { context: contextFor(user) },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  // 031タスク定義5節「1枚でも欠けていたら、投稿ごと拒む。部分的に作らない」。
  // 1枚目はアップロード済み・2枚目は未アップロードという状態で、
  // 1枚目すら書かれていないことまで確認する
  it("複数枚のうち1枚でもR2に実体が無ければ、投稿ごと拒まれる（1枚も書かれていない）", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const [uploaded] = await uploadTestImages(couple.id, [800]);
    const images = [uploaded as { imageId: string; width: number; height: number }, { imageId: generateImageId(), width: 100, height: 100 }];

    await expect(
      call(router.post.create, { body: "半端な投稿", images }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const postRow = await db.prepare("SELECT COUNT(*) AS count FROM posts WHERE body = '半端な投稿'").first<{ count: number }>();
    expect(postRow?.count).toBe(0);
    const imageRow = await db
      .prepare("SELECT COUNT(*) AS count FROM post_images WHERE key = ?1")
      .bind(imageKeyFor(couple.id, uploaded!.imageId))
      .first<{ count: number }>();
    expect(imageRow?.count).toBe(0);
  });

  it("imageId が ULID の形式でない場合は入力バリデーションで弾かれる（007 security-auditor 指摘）", async () => {
    const user = await createUser();
    await createCouple(user);

    await expect(
      call(
        router.post.create,
        { body: "", images: [{ imageId: "../../other-couple/posts/x", width: 100, height: 100 }] },
        { context: contextFor(user) },
      ),
    ).rejects.toThrow();
  });

  it("同じ imageId を2つの投稿で使うと2回目は INVALID_INPUT（UNIQUE制約）", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const images = await uploadTestImages(couple.id, [800]);

    await call(router.post.create, { body: "1件目", images }, { context: contextFor(user) });

    await expect(
      call(router.post.create, { body: "2件目", images }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("サイズ上限を超える画像は INVALID_INPUT になり、R2からも削除される", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const imageId = await uploadTestImage(couple.id, MAX_IMAGE_BYTES + 1);
    const key = imageKeyFor(couple.id, imageId);

    await expect(
      call(router.post.create, { body: "", images: [{ imageId, width: 100, height: 100 }] }, { context: contextFor(user) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    expect(await bucket.head(key)).toBeNull();
  });

  it("Content-Type が image/jpeg 以外の実体は INVALID_INPUT になり、R2からも削除される（007 security-auditor 指摘）", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const imageId = await uploadTestImage(couple.id, 100, "image/png");
    const key = imageKeyFor(couple.id, imageId);

    await expect(
      call(router.post.create, { body: "", images: [{ imageId, width: 100, height: 100 }] }, { context: contextFor(user) }),
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
      call(
        router.post.create,
        { body: "", images: [{ imageId: imageIdOfB, width: 100, height: 100 }] },
        { context: contextFor(userA) },
      ),
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
    const images = await uploadTestImages(couple.id, [800]);
    await call(router.post.create, { body: "", images }, { context: contextFor(user) });

    const result = await call(router.post.list, {}, { context: contextFor(user) });
    expect(result.items[0]?.images[0]?.url).not.toBeNull();
  });

  // 031: imageUrl（単数）は契約から消した。post.listのレスポンスに
  // 残っていないことを確認する（タスク定義「テストで証明すること」）
  it("post.list に imageUrl（単数）が残っていない", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const images = await uploadTestImages(couple.id, [800]);
    await call(router.post.create, { body: "", images }, { context: contextFor(user) });

    const result = await call(router.post.list, {}, { context: contextFor(user) });
    expect(result.items[0]).not.toHaveProperty("imageUrl");
    expect(result.items[0]).not.toHaveProperty("imageWidth");
    expect(result.items[0]).not.toHaveProperty("imageHeight");
  });

  // 031: post_imagesのORDER BY positionが、一覧のimages配列の並び順に
  // そのまま反映されることを確認する
  it("画像の並び順が position のとおりに返る", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const images = await uploadTestImages(couple.id, [111, 222, 333]);
    await call(router.post.create, { body: "並び順", images }, { context: contextFor(user) });

    const result = await call(router.post.list, {}, { context: contextFor(user) });
    expect(result.items[0]?.images.map((i) => i.width)).toEqual([111, 222, 333]);
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

  // 031・security-auditor指摘: post_imagesのDELETE文はEXISTS(posts WHERE
  // id=?1 AND couple_id=?2)で他ペアを弾いているが、これを固定するテストが
  // 無かった（reactionsと同じ形のEXISTS句が抜けると、UPDATEは0件でNOT_FOUND
  // になる一方でDELETEだけが無条件で成立し「投稿は消せないが画像だけ消せる」
  // 経路が生まれうる）。Aの画像付き投稿を持たせ、image_key（他ペアの
  // post_images行・R2実体）に影響が無いことまで確認する
  it("他ペアの投稿IDを指定すると NOT_FOUND になり、対象は削除されない（画像・post_imagesも含めて）", async () => {
    const userA = await createUser();
    const coupleA = await createCouple(userA);
    const images = await uploadTestImages(coupleA.id, [800]);
    const postA = await call(router.post.create, { body: "Aの投稿", images }, { context: contextFor(userA) });

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

    const imageRow = await db
      .prepare("SELECT COUNT(*) AS count FROM post_images WHERE post_id = ?1")
      .bind(postA.id)
      .first<{ count: number }>();
    expect(imageRow?.count).toBe(1);
    expect(await bucket.head(imageKeyFor(coupleA.id, images[0]!.imageId))).not.toBeNull();
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

  // 031タスク定義6節: 「枚数ぶん消す」「post_imagesの行も消す（論理削除を
  // 持たせない）」。4枚とも消えることを確認する
  it("画像付きの投稿を削除すると、枚数ぶんR2のオブジェクトも post_images の行も消える", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const images = await uploadTestImages(couple.id, [100, 200, 300, 400]);
    const keys = images.map((image) => imageKeyFor(couple.id, image.imageId));
    const post = await call(router.post.create, { body: "", images }, { context: contextFor(user) });

    await call(router.post.delete, { id: post.id }, { context: contextFor(user) });

    for (const key of keys) {
      expect(await bucket.head(key)).toBeNull();
    }
    const row = await db
      .prepare("SELECT COUNT(*) AS count FROM post_images WHERE post_id = ?1")
      .bind(post.id)
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  // 031: 論理削除を持たせない設計（post_imagesの行は物理削除される）ため、
  // R2の削除に失敗してもDB側の行はposts更新と同じbatch()で既に消えている。
  // R2に残った実体は孤児として受け入れる（architecture.md 6節の既定を変えない）
  it("R2の削除に失敗しても post.delete は成功として返り、post_images の行は消える", async () => {
    const user = await createUser();
    const couple = await createCouple(user);
    const images = await uploadTestImages(couple.id, [800]);
    const key = imageKeyFor(couple.id, images[0]!.imageId);
    const post = await call(router.post.create, { body: "", images }, { context: contextFor(user) });

    const failingBucket = {
      ...bucket,
      delete: () => Promise.reject(new Error("R2削除失敗（テスト用）")),
    } as unknown as R2Bucket;

    const result = await call(router.post.delete, { id: post.id }, { context: { ...contextFor(user), bucket: failingBucket } });
    expect(result.id).toBe(post.id);

    // post_images の行は既に消えている（DB側はbatch()で先に確定する）
    const row = await db
      .prepare("SELECT COUNT(*) AS count FROM post_images WHERE post_id = ?1")
      .bind(post.id)
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
    // 実際には削除を試みていない（failingBucket）ため実体はR2に孤児として残る
    expect(await bucket.head(key)).not.toBeNull();
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

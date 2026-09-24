import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { FREE_ALBUM_PHOTO_LIMIT } from "@futary/contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";
import { generateImageId } from "../src/lib/ulid";
import { albumImageKeyFor, imageKeyFor } from "../src/lib/r2-signed-url";
import { countAlbumPhotosUsed, resolvePlan } from "../src/lib/plan";

// プランの印（couple_plans）とアルバムの無料枠（045 T1〜T5）。写真は R2 に直接置く
// （album.test.ts の uploadTestAlbumImage と同じ形）

const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

const r2Sign: RpcContext["r2Sign"] = {
  accountId: "test-account",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  bucketName: "test-bucket",
};

type TestUser = { id: string; name: string; email: string };
let userSeq = 0;

async function createUser(): Promise<TestUser> {
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
    db
      .prepare(
        "INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at) VALUES (?1, 'google', ?2, 'google', ?3, ?4, ?4)",
      )
      .bind(crypto.randomUUID(), `google-sub-${id}`, id, now),
  ]);
  return { id, name, email };
}

function contextFor(user: TestUser | null, demoCoupleId: string | null = null): RpcContext {
  return {
    db,
    bucket,
    r2Sign,
    aiEnv: { provider: "openai", openaiApiKey: "test-openai-key" },
    user: user ? { ...user, image: null } : null,
    ip: "203.0.113.1",
    demoCoupleId,
    sessionCreatedAt: user ? Date.now() : null,
    authSecret: "test-secret",
  };
}

async function createPair(): Promise<{ owner: TestUser; partner: TestUser; coupleId: string }> {
  const owner = await createUser();
  const partner = await createUser();
  const couple = await call(router.couple.create, {}, { context: contextFor(owner) });
  const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
  await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
  return { owner, partner, coupleId: couple.id };
}

async function uploadTestAlbumImage(coupleId: string): Promise<string> {
  const imageId = generateImageId();
  await bucket.put(albumImageKeyFor(coupleId, imageId), new Uint8Array(100), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return imageId;
}

async function uploadedPhotos(coupleId: string, count: number) {
  const photos = [];
  for (let i = 0; i < count; i++) {
    photos.push({ imageId: await uploadTestAlbumImage(coupleId), width: 800, height: 600 });
  }
  return photos;
}

// アップロードを経由せず、行と実体を直接作って枚数を積む（30 枚を 1 枚ずつ addPhotos すると遅い）
async function fillAlbum(coupleId: string, albumId: string, count: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const statements = [];
  for (let i = 0; i < count; i++) {
    const id = generateImageId();
    statements.push(
      db
        .prepare(
          `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at)
           VALUES (?1, ?2, ?3, 100, 100, '', ?4, ?4)`,
        )
        .bind(id, albumId, albumImageKeyFor(coupleId, id), now + i),
    );
  }
  if (statements.length > 0) await db.batch(statements);
}

async function countPhotos(albumId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM album_photos WHERE album_id = ?1")
    .bind(albumId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// 運営の切り替え SQL と同じ文（タスク定義 1節。artifacts/045/ に置く）
async function setPlan(coupleId: string, plan: string, expiresAt: number | null = null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO couple_plans (couple_id, plan, source, expires_at, updated_at) VALUES (?1, ?2, 'manual', ?3, unixepoch())
       ON CONFLICT(couple_id) DO UPDATE SET plan = ?2, expires_at = ?3, updated_at = unixepoch()`,
    )
    .bind(coupleId, plan, expiresAt)
    .run();
}

async function createAlbum(owner: TestUser, title = "アルバム"): Promise<string> {
  const album = await call(router.album.create, { title }, { context: contextFor(owner) });
  return album.id;
}

const LIMIT = FREE_ALBUM_PHOTO_LIMIT;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("resolvePlan（判定の 1 箇所）", () => {
  const now = 1_800_000_000;
  it("行が無ければ free", () => {
    expect(resolvePlan(null, now)).toBe("free");
    expect(resolvePlan(undefined, now)).toBe("free");
  });
  it("plan='paid' で期限なしなら paid", () => {
    expect(resolvePlan({ plan: "paid", expires_at: null }, now)).toBe("paid");
  });
  it("plan='paid' で期限が未来なら paid、過ぎていれば free（ちょうど今も free）", () => {
    expect(resolvePlan({ plan: "paid", expires_at: now + 1 }, now)).toBe("paid");
    expect(resolvePlan({ plan: "paid", expires_at: now }, now)).toBe("free");
    expect(resolvePlan({ plan: "paid", expires_at: now - 1 }, now)).toBe("free");
  });
  it("plan='free'・未知の文字列（'PAID'・'premium'・空）は全部 free", () => {
    expect(resolvePlan({ plan: "free", expires_at: null }, now)).toBe("free");
    expect(resolvePlan({ plan: "PAID", expires_at: null }, now)).toBe("free");
    expect(resolvePlan({ plan: "premium", expires_at: null }, now)).toBe("free");
    expect(resolvePlan({ plan: "", expires_at: null }, now)).toBe("free");
  });
});

describe("T1: free の addPhotos は無料枠で止まる（1 枚も入れない）", () => {
  it(`${LIMIT} 枚入っている状態で 1 枚 → PLAN_LIMIT。行も R2 も増えない`, async () => {
    const { owner, coupleId } = await createPair();
    const albumId = await createAlbum(owner);
    await fillAlbum(coupleId, albumId, LIMIT);
    const photos = await uploadedPhotos(coupleId, 1);

    await expect(
      call(router.album.addPhotos, { id: albumId, photos }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });

    expect(await countPhotos(albumId)).toBe(LIMIT);
    // 実体は消さない（アップロード済みの孤児は uploadUrl の経路の話。行だけ増えないことを見る）
    expect(await db.prepare("SELECT 1 FROM album_photos WHERE id = ?1").bind(photos[0]!.imageId).first()).toBeNull();
  });

  it(`${LIMIT - 1} 枚で 2 枚 → PLAN_LIMIT（1 枚も入れない）。${LIMIT - 1} 枚で 1 枚 → 入る`, async () => {
    const { owner, coupleId } = await createPair();
    const albumId = await createAlbum(owner);
    await fillAlbum(coupleId, albumId, LIMIT - 1);

    const two = await uploadedPhotos(coupleId, 2);
    await expect(
      call(router.album.addPhotos, { id: albumId, photos: two }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });
    expect(await countPhotos(albumId)).toBe(LIMIT - 1);

    const one = await uploadedPhotos(coupleId, 1);
    const album = await call(router.album.addPhotos, { id: albumId, photos: one }, { context: contextFor(owner) });
    expect(album.photoCount).toBe(LIMIT);
    expect(await countPhotos(albumId)).toBe(LIMIT);
  });

  it("枠はペア全体で数える: 別のアルバムに入っている分も合算される", async () => {
    const { owner, coupleId } = await createPair();
    const first = await createAlbum(owner, "1 つ目");
    const second = await createAlbum(owner, "2 つ目");
    await fillAlbum(coupleId, first, LIMIT - 1);
    await fillAlbum(coupleId, second, 1);

    const one = await uploadedPhotos(coupleId, 1);
    await expect(
      call(router.album.addPhotos, { id: second, photos: one }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });
  });

  it("PLAN_LIMIT は LIMIT_REACHED（1 アルバム 500 枚）より先に見る", async () => {
    const { owner, coupleId } = await createPair();
    const albumId = await createAlbum(owner);
    await fillAlbum(coupleId, albumId, 500);
    const one = await uploadedPhotos(coupleId, 1);
    await expect(
      call(router.album.addPhotos, { id: albumId, photos: one }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });
  });
});

describe("T2: free の album.create（cover あり）も同じ", () => {
  it(`${LIMIT} 枚入っている状態で cover あり → PLAN_LIMIT。アルバムも作られない`, async () => {
    const { owner, coupleId } = await createPair();
    const albumId = await createAlbum(owner);
    await fillAlbum(coupleId, albumId, LIMIT);
    const [cover] = await uploadedPhotos(coupleId, 1);

    await expect(
      call(router.album.create, { title: "作られない", cover }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });

    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM albums WHERE couple_id = ?1")
      .bind(coupleId)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it(`${LIMIT} 枚入っていても cover なしのアルバムは作れる（枚数の制限であってアルバム数の制限ではない）`, async () => {
    const { owner, coupleId } = await createPair();
    const albumId = await createAlbum(owner);
    await fillAlbum(coupleId, albumId, LIMIT);
    const created = await call(router.album.create, { title: "cover なし" }, { context: contextFor(owner) });
    expect(created.photoCount).toBe(0);
  });

  it(`${LIMIT - 1} 枚で cover あり → 入る（ちょうど ${LIMIT} 枚になる）`, async () => {
    const { owner, coupleId } = await createPair();
    const albumId = await createAlbum(owner);
    await fillAlbum(coupleId, albumId, LIMIT - 1);
    const [cover] = await uploadedPhotos(coupleId, 1);
    const created = await call(router.album.create, { title: "入る", cover }, { context: contextFor(owner) });
    expect(created.photoCount).toBe(1);
    expect(await countAlbumPhotosUsed(db, coupleId)).toBe(LIMIT);
  });
});

describe("T3: paid は制限しない。期限切れ・未知の値は free", () => {
  it(`paid（行あり・期限なし）→ ${LIMIT + 1} 枚目が入る`, async () => {
    const { owner, coupleId } = await createPair();
    await setPlan(coupleId, "paid");
    const albumId = await createAlbum(owner);
    await fillAlbum(coupleId, albumId, LIMIT);
    const one = await uploadedPhotos(coupleId, 1);
    const album = await call(router.album.addPhotos, { id: albumId, photos: one }, { context: contextFor(owner) });
    expect(album.photoCount).toBe(LIMIT + 1);
  });

  it("paid で期限が未来 → 入る。期限が過去 → free 扱いで PLAN_LIMIT", async () => {
    const { owner, coupleId } = await createPair();
    const albumId = await createAlbum(owner);
    await fillAlbum(coupleId, albumId, LIMIT);
    const now = Math.floor(Date.now() / 1000);

    await setPlan(coupleId, "paid", now + 3600);
    const one = await uploadedPhotos(coupleId, 1);
    await call(router.album.addPhotos, { id: albumId, photos: one }, { context: contextFor(owner) });

    await setPlan(coupleId, "paid", now - 1);
    const another = await uploadedPhotos(coupleId, 1);
    await expect(
      call(router.album.addPhotos, { id: albumId, photos: another }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });
  });

  it("plan が未知の文字列（'premium'）→ free 扱い。'free' に戻しても free", async () => {
    const { owner, coupleId } = await createPair();
    const albumId = await createAlbum(owner);
    await fillAlbum(coupleId, albumId, LIMIT);

    await setPlan(coupleId, "premium");
    const one = await uploadedPhotos(coupleId, 1);
    await expect(
      call(router.album.addPhotos, { id: albumId, photos: one }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });

    await setPlan(coupleId, "paid");
    await call(router.album.addPhotos, { id: albumId, photos: one }, { context: contextFor(owner) });

    await setPlan(coupleId, "free");
    const another = await uploadedPhotos(coupleId, 1);
    await expect(
      call(router.album.addPhotos, { id: albumId, photos: another }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });
  });
});

describe("T4: used の数え方", () => {
  it("削除済みアルバムの写真は数えない（削除すれば枠が戻る）", async () => {
    const { owner, coupleId } = await createPair();
    const doomed = await createAlbum(owner, "消す");
    await fillAlbum(coupleId, doomed, LIMIT);
    expect(await countAlbumPhotosUsed(db, coupleId)).toBe(LIMIT);

    await call(router.album.delete, { id: doomed }, { context: contextFor(owner) });
    expect(await countAlbumPhotosUsed(db, coupleId)).toBe(0);

    const albumId = await createAlbum(owner, "残る");
    const one = await uploadedPhotos(coupleId, 1);
    const album = await call(router.album.addPhotos, { id: albumId, photos: one }, { context: contextFor(owner) });
    expect(album.photoCount).toBe(1);
  });

  // album.delete は album_photos を物理削除するので、上のテストは `albums.deleted_at IS NULL` を外しても
  // 緑のまま。deleted_at を SQL で直接立てて写真行を残し、条件が効くことを見る（外すと赤）
  it("albums.deleted_at が立っていて写真行が残っていても、その写真は数えない（条件を外すと赤）", async () => {
    const { owner, coupleId } = await createPair();
    const doomed = await createAlbum(owner, "論理削除だけ");
    await fillAlbum(coupleId, doomed, 5);
    const alive = await createAlbum(owner, "生きている");
    await fillAlbum(coupleId, alive, 2);

    await db
      .prepare("UPDATE albums SET deleted_at = ?1 WHERE id = ?2")
      .bind(Math.floor(Date.now() / 1000), doomed)
      .run();
    // 写真行は残っている（物理削除していない）
    expect(await countPhotos(doomed)).toBe(5);

    expect(await countAlbumPhotosUsed(db, coupleId)).toBe(2);
    const couple = await call(router.couple.get, undefined, { context: contextFor(owner) });
    expect(couple.albumQuota).toEqual({ limit: LIMIT, used: 2 });
  });

  it("タイムライン（post_images）は数えない", async () => {
    const { owner, coupleId } = await createPair();
    const postId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const statements = [
      db
        .prepare("INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (?1, ?2, ?3, '写真', ?4)")
        .bind(postId, coupleId, owner.id, now),
    ];
    for (let position = 0; position < 4; position++) {
      statements.push(
        db
          .prepare("INSERT INTO post_images (post_id, position, key, width, height) VALUES (?1, ?2, ?3, 100, 100)")
          .bind(postId, position, imageKeyFor(coupleId, generateImageId())),
      );
    }
    await db.batch(statements);
    expect(await countAlbumPhotosUsed(db, coupleId)).toBe(0);
  });

  it("別ペアの写真は数えない", async () => {
    const { owner, coupleId } = await createPair();
    const other = await createPair();
    const otherAlbum = await createAlbum(other.owner, "よそ");
    await fillAlbum(other.coupleId, otherAlbum, LIMIT);

    expect(await countAlbumPhotosUsed(db, coupleId)).toBe(0);
    expect(await countAlbumPhotosUsed(db, other.coupleId)).toBe(LIMIT);

    const albumId = await createAlbum(owner);
    const one = await uploadedPhotos(coupleId, 1);
    const album = await call(router.album.addPhotos, { id: albumId, photos: one }, { context: contextFor(owner) });
    expect(album.photoCount).toBe(1);
  });
});

describe("T5: couple.get が plan と albumQuota を返す", () => {
  it(`free（行なし）: plan='free'・albumQuota={limit:${LIMIT}, used:n}。足すと used が増える`, async () => {
    const { owner, coupleId } = await createPair();
    const before = await call(router.couple.get, undefined, { context: contextFor(owner) });
    expect(before.plan).toBe("free");
    expect(before.albumQuota).toEqual({ limit: LIMIT, used: 0 });

    const albumId = await createAlbum(owner);
    await fillAlbum(coupleId, albumId, 3);
    const after = await call(router.couple.get, undefined, { context: contextFor(owner) });
    expect(after.albumQuota).toEqual({ limit: LIMIT, used: 3 });
  });

  it("paid: plan='paid'・albumQuota=null（どれだけ入っていても）", async () => {
    const { owner, coupleId } = await createPair();
    await setPlan(coupleId, "paid");
    const albumId = await createAlbum(owner);
    await fillAlbum(coupleId, albumId, LIMIT + 5);
    const couple = await call(router.couple.get, undefined, { context: contextFor(owner) });
    expect(couple.plan).toBe("paid");
    expect(couple.albumQuota).toBeNull();
  });

  it("ゲスト（デモペア）にも返る。デモは paid の行を持つ想定だが、行が無ければ free で返る", async () => {
    const owner = await createUser();
    const couple = await call(router.couple.create, {}, { context: contextFor(owner) });
    await db.prepare("UPDATE couples SET is_demo = 1 WHERE id = ?1").bind(couple.id).run();

    const asGuest = await call(router.couple.get, undefined, { context: contextFor(null, couple.id) });
    expect(asGuest.plan).toBe("free");
    expect(asGuest.albumQuota).toEqual({ limit: LIMIT, used: 0 });

    await setPlan(couple.id, "paid");
    const asGuestPaid = await call(router.couple.get, undefined, { context: contextFor(null, couple.id) });
    expect(asGuestPaid.plan).toBe("paid");
    expect(asGuestPaid.albumQuota).toBeNull();
  });
});

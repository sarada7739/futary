import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";
import { generateImageId } from "../src/lib/ulid";
import { albumImageKeyFor, imageKeyFor } from "../src/lib/r2-signed-url";
import { D1_MAX_BOUND_PARAMETERS } from "../src/procedures/album";

// 041: アルバム（T1〜T7・T9）。want.test.ts と同じ形でペアと R2 の実体を用意する
const db = (env as unknown as Bindings).DB;
const bucket = (env as unknown as Bindings).BUCKET;

// wish.test.ts と同じ理由（実際の R2 API トークンの設定有無にテストの合否を左右させない）
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

// album.uploadUrl を経由せず R2 に直接オブジェクトを置く（post.test.ts の uploadTestImage と同じ形）
async function uploadTestAlbumImage(coupleId: string, sizeBytes = 100, contentType = "image/jpeg"): Promise<string> {
  const imageId = generateImageId();
  await bucket.put(albumImageKeyFor(coupleId, imageId), new Uint8Array(sizeBytes), {
    httpMetadata: { contentType },
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

// created_at を直接指定して写真付きの投稿を作る（同一秒の重複・欠落テストのため、
// post.create の now() 依存を避けて直接 DB へ挿入する。post.test.ts の insertPost と同じ）
async function insertPostWithImages(
  coupleId: string,
  authorId: string,
  createdAt: number,
  imageCount: number,
  body = "写真付きの投稿",
): Promise<string> {
  const id = crypto.randomUUID();
  const statements = [
    db
      .prepare("INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(id, coupleId, authorId, body, createdAt),
  ];
  for (let position = 0; position < imageCount; position++) {
    statements.push(
      db
        .prepare("INSERT INTO post_images (post_id, position, key, width, height) VALUES (?1, ?2, ?3, 100, 100)")
        .bind(id, position, imageKeyFor(coupleId, generateImageId())),
    );
  }
  await db.batch(statements);
  return id;
}

// taken_at を直接指定してアルバムに写真を入れる（同一秒・上限のテスト用）
async function insertAlbumPhoto(coupleId: string, albumId: string, takenAt: number, caption = ""): Promise<string> {
  const id = generateImageId();
  await db
    .prepare(
      `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at)
       VALUES (?1, ?2, ?3, 100, 100, ?4, ?5, ?5)`,
    )
    .bind(id, albumId, albumImageKeyFor(coupleId, id), caption, takenAt)
    .run();
  return id;
}

async function countAlbumPhotos(albumId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM album_photos WHERE album_id = ?1")
    .bind(albumId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

describe("album.create / album.list / album.get（基本）", () => {
  it("題名だけで作れる。一覧に新しい順で出る。写真 0 枚なら cover は null", async () => {
    const { owner, partner } = await createPair();
    const first = await call(router.album.create, { title: "京都旅行" }, { context: contextFor(owner) });
    const second = await call(
      router.album.create,
      { title: "沖縄", note: "夏休み", startDate: "2026-07-01", endDate: "2026-07-03" },
      { context: contextFor(partner) },
    );

    expect(first).toMatchObject({ title: "京都旅行", note: "", startDate: null, endDate: null, photoCount: 0, cover: null });
    expect(second).toMatchObject({ title: "沖縄", note: "夏休み", startDate: "2026-07-01", endDate: "2026-07-03" });

    const list = await call(router.album.list, {}, { context: contextFor(owner) });
    // 同秒なら id の降順。created_at は同じなので順序はどちらもありうるが、2 件とも出る
    expect(list.items.map((a) => a.id).sort()).toEqual([first.id, second.id].sort());
    expect(list.timeline).toEqual({ photoCount: 0, previews: [] });

    const fetched = await call(router.album.get, { id: second.id }, { context: contextFor(owner) });
    expect(fetched.title).toBe("沖縄");
  });

  it("cover を付けて作ると最初の 1 枚として入り、カバーになる（署名付き URL に鍵が含まれる）", async () => {
    const { owner, coupleId } = await createPair();
    const imageId = await uploadTestAlbumImage(coupleId);

    const album = await call(
      router.album.create,
      { title: "カバーあり", cover: { imageId, width: 1200, height: 900 } },
      { context: contextFor(owner) },
    );

    expect(album.photoCount).toBe(1);
    expect(album.cover?.url).toContain(albumImageKeyFor(coupleId, imageId));
    expect(album.cover).toMatchObject({ width: 1200, height: 900 });

    const photos = await call(router.photo.list, { albumId: album.id }, { context: contextFor(owner) });
    expect(photos.items).toHaveLength(1);
    expect(photos.items[0]?.ref).toEqual({ kind: "album", photoId: imageId });
  });

  it("終了日だけ・終了日が開始日より前は入力で弾かれる", async () => {
    const { owner } = await createPair();
    await expect(
      call(router.album.create, { title: "x", endDate: "2026-07-03" }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      call(
        router.album.create,
        { title: "x", startDate: "2026-07-05", endDate: "2026-07-03" },
        { context: contextFor(owner) },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("album.list はタイムライン（写真付き投稿の写真）の枚数と最新 4 枚を返す。削除済み投稿は数えない", async () => {
    const { owner, coupleId } = await createPair();
    const base = 1_700_000_000;
    await insertPostWithImages(coupleId, owner.id, base, 3);
    await insertPostWithImages(coupleId, owner.id, base + 10, 2);
    const deleted = await insertPostWithImages(coupleId, owner.id, base + 20, 4);
    await call(router.post.delete, { id: deleted }, { context: contextFor(owner) });

    const list = await call(router.album.list, {}, { context: contextFor(owner) });

    expect(list.timeline.photoCount).toBe(5);
    expect(list.timeline.previews).toHaveLength(4);
    // 新しい投稿（base + 10）の 2 枚が先、そのあと古い投稿の position 0・1
    expect(list.timeline.previews.map((p) => p.takenAt)).toEqual([base + 10, base + 10, base, base]);
    expect(list.timeline.previews.map((p) => (p.ref.kind === "post" ? p.ref.position : -1))).toEqual([0, 1, 0, 1]);
  });
});

// R の段階1レビューの記録 1（A の決定 #296）: post.delete は post_images を物理削除するため、
// `posts.deleted_at IS NULL` の条件が効く場面は今は無い（外してもテストが緑だった）。
// 条文（architecture.md 4節「posts を読むクエリには必ず deleted_at IS NULL を含める」）を試せる形で
// 置くため、deleted_at を SQL で直接立てて post_images の行を残した状態を作る
describe("posts.deleted_at IS NULL の条件そのもの（post_images の行が残っていても出さない）", () => {
  it("photo.list（タイムライン）にも album.list の timeline にも、削除済み投稿の写真は出ない", async () => {
    const { owner, coupleId } = await createPair();
    const base = 1_700_000_000;
    const alive = await insertPostWithImages(coupleId, owner.id, base, 1, "生きている");
    const deleted = await insertPostWithImages(coupleId, owner.id, base + 10, 2, "消したのに行が残っている");
    // post.delete を通さず deleted_at だけ立てる（post_images は残る）
    await db.prepare("UPDATE posts SET deleted_at = ?1 WHERE id = ?2").bind(base + 20, deleted).run();
    const remaining = await db
      .prepare("SELECT COUNT(*) AS count FROM post_images WHERE post_id = ?1")
      .bind(deleted)
      .first<{ count: number }>();
    expect(remaining?.count).toBe(2);

    const photos = await call(router.photo.list, {}, { context: contextFor(owner) });
    expect(photos.items.map((p) => (p.ref.kind === "post" ? p.ref.postId : ""))).toEqual([alive]);

    const list = await call(router.album.list, {}, { context: contextFor(owner) });
    expect(list.timeline.photoCount).toBe(1);
    expect(list.timeline.previews.map((p) => (p.ref.kind === "post" ? p.ref.postId : ""))).toEqual([alive]);

    // 保存 URL も同じ条件で引く
    await expect(
      call(router.photo.downloadUrl, { kind: "post", postId: deleted, position: 0 }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("T1: couple_id スコープ", () => {
  it("別ペアのアルバムは list に出ず、get / update / addPhotos / updatePhoto / removePhotos / delete / photo.list は NOT_FOUND（存在しない id と同じ応答）", async () => {
    const a = await createPair();
    const b = await createPair();
    const albumA = await call(
      router.album.create,
      { title: "A のアルバム", cover: { imageId: await uploadTestAlbumImage(a.coupleId), width: 1, height: 1 } },
      { context: contextFor(a.owner) },
    );
    const photoIdA = (await call(router.photo.list, { albumId: albumA.id }, { context: contextFor(a.owner) })).items[0]!;
    const photoA = photoIdA.ref.kind === "album" ? photoIdA.ref.photoId : "";

    const listB = await call(router.album.list, {}, { context: contextFor(b.owner) });
    expect(listB.items).toEqual([]);

    const ctxB = { context: contextFor(b.owner) };
    const missing = crypto.randomUUID();
    for (const id of [albumA.id, missing]) {
      await expect(call(router.album.get, { id }, ctxB)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(call(router.album.update, { id, title: "書き換え" }, ctxB)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        call(router.album.addPhotos, { id, photos: await uploadedPhotos(b.coupleId, 1) }, ctxB),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(call(router.album.updatePhoto, { id, photoId: photoA, caption: "x" }, ctxB)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(call(router.album.removePhotos, { id, photoIds: [photoA] }, ctxB)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(call(router.album.delete, { id }, ctxB)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(call(router.photo.list, { albumId: id }, ctxB)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }

    // A 側は何も変わっていない
    const stillA = await call(router.album.get, { id: albumA.id }, { context: contextFor(a.owner) });
    expect(stillA.title).toBe("A のアルバム");
    expect(stillA.photoCount).toBe(1);
  });

  it("削除済みのアルバムは自ペアでも NOT_FOUND", async () => {
    const { owner } = await createPair();
    const album = await call(router.album.create, { title: "消す" }, { context: contextFor(owner) });
    await call(router.album.delete, { id: album.id }, { context: contextFor(owner) });

    await expect(call(router.album.get, { id: album.id }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const list = await call(router.album.list, {}, { context: contextFor(owner) });
    expect(list.items).toEqual([]);
  });

  it("ペアのもう 1 人も編集・削除できる（canEdit は無い）", async () => {
    const { owner, partner } = await createPair();
    const album = await call(router.album.create, { title: "ふたりの" }, { context: contextFor(owner) });
    const updated = await call(router.album.update, { id: album.id, title: "相手が直した" }, { context: contextFor(partner) });
    expect(updated.title).toBe("相手が直した");
    await call(router.album.delete, { id: album.id }, { context: contextFor(partner) });
  });
});

describe("T2: R2 に実体が無い imageId は INVALID_INPUT で、アルバムも行も作られない", () => {
  it("album.create の cover に実体が無いとアルバムも作られない", async () => {
    const { owner, coupleId } = await createPair();
    await expect(
      call(
        router.album.create,
        { title: "作られない", cover: { imageId: generateImageId(), width: 1, height: 1 } },
        { context: contextFor(owner) },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const row = await db.prepare("SELECT COUNT(*) AS count FROM albums WHERE couple_id = ?1").bind(coupleId).first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("addPhotos: 複数枚のうち 1 枚だけ実体が無いと INVALID_INPUT で 1 枚も入らない", async () => {
    const { owner, coupleId } = await createPair();
    const album = await call(router.album.create, { title: "部分的に入れない" }, { context: contextFor(owner) });
    const photos = await uploadedPhotos(coupleId, 2);
    photos.push({ imageId: generateImageId(), width: 1, height: 1 });

    await expect(call(router.album.addPhotos, { id: album.id, photos }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(await countAlbumPhotos(album.id)).toBe(0);
  });

  it("型が違う実体（image/png）は INVALID_INPUT で、その実体は消される", async () => {
    const { owner, coupleId } = await createPair();
    const album = await call(router.album.create, { title: "型違い" }, { context: contextFor(owner) });
    const imageId = await uploadTestAlbumImage(coupleId, 100, "image/png");

    await expect(
      call(router.album.addPhotos, { id: album.id, photos: [{ imageId, width: 1, height: 1 }] }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await bucket.head(albumImageKeyFor(coupleId, imageId))).toBeNull();
  });

  it("同じ imageId を 2 回入れると INVALID_INPUT（key の UNIQUE）", async () => {
    const { owner, coupleId } = await createPair();
    const album = await call(router.album.create, { title: "二重" }, { context: contextFor(owner) });
    const [photo] = await uploadedPhotos(coupleId, 1);
    await call(router.album.addPhotos, { id: album.id, photos: [photo!] }, { context: contextFor(owner) });
    await expect(
      call(router.album.addPhotos, { id: album.id, photos: [photo!] }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await countAlbumPhotos(album.id)).toBe(1);
  });
});

describe("T3: D1 → R2 の順。R2 の削除が失敗しても手続きは成功する", () => {
  it("removePhotos は行を消してから R2 を消す。入っていない id は無視", async () => {
    const { owner, coupleId } = await createPair();
    const album = await call(router.album.create, { title: "外す" }, { context: contextFor(owner) });
    const photos = await uploadedPhotos(coupleId, 3);
    await call(router.album.addPhotos, { id: album.id, photos }, { context: contextFor(owner) });

    const result = await call(
      router.album.removePhotos,
      { id: album.id, photoIds: [photos[0]!.imageId, photos[1]!.imageId, "not-in-album"] },
      { context: contextFor(owner) },
    );

    expect(result.photoCount).toBe(1);
    expect(await bucket.head(albumImageKeyFor(coupleId, photos[0]!.imageId))).toBeNull();
    expect(await bucket.head(albumImageKeyFor(coupleId, photos[1]!.imageId))).toBeNull();
    expect(await bucket.head(albumImageKeyFor(coupleId, photos[2]!.imageId))).not.toBeNull();
  });

  // R の段階1レビュー（必須修正）: D1 は 1 文の束縛パラメータが 100 まで。100 枚を 1 回で消すと
  // IN 句 + 2 個で超える。ローカルの SQLite は通してしまうため、db.prepare に渡った SQL の
  // プレースホルダを数えて「文ごとに 100 以下」を固定する（batch の中の各文に個別に適用される）
  it("100 枚を 1 回の removePhotos で消せる。文ごとの束縛パラメータは D1 の上限（100）を超えない", async () => {
    const { owner, coupleId } = await createPair();
    const album = await call(router.album.create, { title: "100 枚" }, { context: contextFor(owner) });
    const ids: string[] = [];
    const inserts = [];
    for (let i = 0; i < 100; i++) {
      const id = generateImageId();
      ids.push(id);
      inserts.push(
        db
          .prepare(
            `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at)
             VALUES (?1, ?2, ?3, 1, 1, '', ?4, ?4)`,
          )
          .bind(id, album.id, albumImageKeyFor(coupleId, id), 1_000 + i),
      );
    }
    await db.batch(inserts);

    // prepare に渡った SQL を記録する（束縛は SQL の ?N の数と一致する。bind の個数も数える）
    const boundCounts: number[] = [];
    const recordingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "prepare") return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          const statement = target.prepare(sql);
          const placeholderCount = new Set(sql.match(/\?\d+/g) ?? []).size;
          const original = statement.bind.bind(statement);
          statement.bind = ((...values: unknown[]) => {
            boundCounts.push(Math.max(placeholderCount, values.length));
            return original(...values);
          }) as typeof statement.bind;
          return statement;
        };
      },
    });

    const result = await call(
      router.album.removePhotos,
      { id: album.id, photoIds: ids },
      { context: { ...contextFor(owner), db: recordingDb } },
    );

    expect(result.photoCount).toBe(0);
    expect(await countAlbumPhotos(album.id)).toBe(0);
    expect(boundCounts.length).toBeGreaterThan(0);
    expect(Math.max(...boundCounts)).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
    // 100 個の id は 2 文以上に分かれている（1 文なら 102 個になる）
    expect(boundCounts.filter((n) => n > 2).length).toBeGreaterThanOrEqual(2);
  });

  it("R2 の削除に失敗しても removePhotos / album.delete は成功して返り、行は消えている", async () => {
    const { owner, coupleId } = await createPair();
    const album = await call(router.album.create, { title: "R2 が落ちる" }, { context: contextFor(owner) });
    const photos = await uploadedPhotos(coupleId, 2);
    await call(router.album.addPhotos, { id: album.id, photos }, { context: contextFor(owner) });
    const failingBucket = {
      ...bucket,
      delete: () => Promise.reject(new Error("R2削除失敗（テスト用）")),
    } as unknown as R2Bucket;
    const ctx = { context: { ...contextFor(owner), bucket: failingBucket } };

    const afterRemove = await call(router.album.removePhotos, { id: album.id, photoIds: [photos[0]!.imageId] }, ctx);
    expect(afterRemove.photoCount).toBe(1);
    expect(await countAlbumPhotos(album.id)).toBe(1);
    // 実際には削除を試みていないため実体は孤児として残る
    expect(await bucket.head(albumImageKeyFor(coupleId, photos[0]!.imageId))).not.toBeNull();

    const deleted = await call(router.album.delete, { id: album.id }, ctx);
    expect(deleted.id).toBe(album.id);
    expect(await countAlbumPhotos(album.id)).toBe(0);
    const row = await db.prepare("SELECT deleted_at AS deleted_at FROM albums WHERE id = ?1").bind(album.id).first<{ deleted_at: number | null }>();
    expect(row?.deleted_at).not.toBeNull();
  });

  it("album.delete は album_photos の行と R2 の実体を消す", async () => {
    const { owner, coupleId } = await createPair();
    const album = await call(router.album.create, { title: "消す" }, { context: contextFor(owner) });
    const photos = await uploadedPhotos(coupleId, 2);
    await call(router.album.addPhotos, { id: album.id, photos }, { context: contextFor(owner) });

    await call(router.album.delete, { id: album.id }, { context: contextFor(owner) });

    expect(await countAlbumPhotos(album.id)).toBe(0);
    for (const photo of photos) {
      expect(await bucket.head(albumImageKeyFor(coupleId, photo.imageId))).toBeNull();
    }
  });

  it("カバーだった写真を外すと cover は自動（いちばん新しい写真）に倒れる。cover_photo_id を null にしても同じ", async () => {
    const { owner, coupleId } = await createPair();
    const album = await call(router.album.create, { title: "カバー" }, { context: contextFor(owner) });
    const oldId = await insertAlbumPhoto(coupleId, album.id, 1_000);
    const newId = await insertAlbumPhoto(coupleId, album.id, 2_000);

    const withCover = await call(router.album.update, { id: album.id, coverPhotoId: oldId }, { context: contextFor(owner) });
    expect(withCover.cover?.url).toContain(albumImageKeyFor(coupleId, oldId));

    const afterRemove = await call(router.album.removePhotos, { id: album.id, photoIds: [oldId] }, { context: contextFor(owner) });
    expect(afterRemove.cover?.url).toContain(albumImageKeyFor(coupleId, newId));

    const another = await insertAlbumPhoto(coupleId, album.id, 3_000);
    const auto = await call(router.album.update, { id: album.id, coverPhotoId: null }, { context: contextFor(owner) });
    expect(auto.cover?.url).toContain(albumImageKeyFor(coupleId, another));
  });
});

describe("T4 / T5: photo.list の並びとカーソル", () => {
  it("タイムラインは新しい順で、削除済み投稿の写真を出さない。同秒の投稿 2 件を含めてカーソルで重複なく全件辿れる", async () => {
    const { owner, coupleId } = await createPair();
    const base = 1_700_000_000;
    // 同秒の投稿 2 件（各 2 枚）+ 別の秒の投稿 + 削除済み
    await insertPostWithImages(coupleId, owner.id, base, 2, "同秒 1");
    await insertPostWithImages(coupleId, owner.id, base, 2, "同秒 2");
    await insertPostWithImages(coupleId, owner.id, base + 5, 3, "新しい");
    const deleted = await insertPostWithImages(coupleId, owner.id, base + 9, 1, "削除済み");
    await call(router.post.delete, { id: deleted }, { context: contextFor(owner) });

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await call(router.photo.list, { cursor, limit: 2 }, { context: contextFor(owner) });
      for (const item of page.items) {
        expect(item.ref.kind).toBe("post");
        if (item.ref.kind === "post") seen.push(`${item.ref.postId}:${item.ref.position}`);
      }
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(4);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen.some((s) => s.startsWith(deleted))).toBe(false);

    // 新しい順: 先頭は base + 5 の投稿。caption は投稿本文
    const first = await call(router.photo.list, { limit: 3 }, { context: contextFor(owner) });
    expect(first.items.map((p) => p.takenAt)).toEqual([base + 5, base + 5, base + 5]);
    expect(first.items.map((p) => p.caption)).toEqual(["新しい", "新しい", "新しい"]);
    expect(first.items.map((p) => (p.ref.kind === "post" ? p.ref.position : -1))).toEqual([0, 1, 2]);
  });

  it("アルバムは古い順で、同秒の写真 2 枚を含めてカーソルで重複なく全件辿れる", async () => {
    const { owner, coupleId } = await createPair();
    const album = await call(router.album.create, { title: "順" }, { context: contextFor(owner) });
    const ids = [
      await insertAlbumPhoto(coupleId, album.id, 3_000, "3 日目"),
      await insertAlbumPhoto(coupleId, album.id, 1_000, "1 日目"),
      await insertAlbumPhoto(coupleId, album.id, 2_000, "2 日目 a"),
      await insertAlbumPhoto(coupleId, album.id, 2_000, "2 日目 b"),
      await insertAlbumPhoto(coupleId, album.id, 2_000, "2 日目 c"),
    ];

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await call(router.photo.list, { albumId: album.id, cursor, limit: 2 }, { context: contextFor(owner) });
      for (const item of page.items) {
        if (item.ref.kind === "album") seen.push(item.ref.photoId);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    // 古い順。同秒は id の昇順
    const all = await call(router.photo.list, { albumId: album.id, limit: 60 }, { context: contextFor(owner) });
    expect(all.items.map((p) => p.takenAt)).toEqual([1_000, 2_000, 2_000, 2_000, 3_000]);
    expect(all.items[0]?.caption).toBe("1 日目");
    const sameSecond = all.items.slice(1, 4).map((p) => (p.ref.kind === "album" ? p.ref.photoId : ""));
    expect(sameSecond).toEqual([...sameSecond].sort());
    expect(ids).toContain(all.items[4]?.ref.kind === "album" ? all.items[4].ref.photoId : "");
  });

  it("壊れたカーソルは INVALID_INPUT", async () => {
    const { owner } = await createPair();
    await expect(call(router.photo.list, { cursor: "not-base64!" }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    const album = await call(router.album.create, { title: "x" }, { context: contextFor(owner) });
    await expect(
      call(router.photo.list, { albumId: album.id, cursor: btoa("{}") }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("T6: 上限", () => {
  it("499 枚のアルバムに 2 枚入れると LIMIT_REACHED で 1 枚も入らない。1 枚なら入る", async () => {
    const { owner, coupleId } = await createPair();
    // 045: 物理上限（500 枚）の検査は無料枠（30 枚）より後ろにあるため、paid にしてから確かめる
    // （free のままだと PLAN_LIMIT が先に出る。plan.test.ts の T1 が固定している）
    await db
      .prepare("INSERT INTO couple_plans (couple_id, plan, source, updated_at) VALUES (?1, 'paid', 'manual', unixepoch())")
      .bind(coupleId)
      .run();
    const album = await call(router.album.create, { title: "いっぱい" }, { context: contextFor(owner) });
    const statements = [];
    for (let i = 0; i < 499; i++) {
      const id = generateImageId();
      statements.push(
        db
          .prepare(
            `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at)
             VALUES (?1, ?2, ?3, 1, 1, '', ?4, ?4)`,
          )
          .bind(id, album.id, albumImageKeyFor(coupleId, id), 1_000 + i),
      );
    }
    await db.batch(statements);

    const two = await uploadedPhotos(coupleId, 2);
    await expect(call(router.album.addPhotos, { id: album.id, photos: two }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "LIMIT_REACHED",
    });
    expect(await countAlbumPhotos(album.id)).toBe(499);

    const one = await call(router.album.addPhotos, { id: album.id, photos: [two[0]!] }, { context: contextFor(owner) });
    expect(one.photoCount).toBe(500);

    await expect(
      call(router.album.addPhotos, { id: album.id, photos: [two[1]!] }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });

  it("101 件目のアルバムは LIMIT_REACHED。削除済みは数えない", async () => {
    const { owner, coupleId } = await createPair();
    const now = Math.floor(Date.now() / 1000);
    const statements = [];
    for (let i = 0; i < 100; i++) {
      statements.push(
        db
          .prepare(
            `INSERT INTO albums (id, couple_id, title, note, created_by, created_at, updated_at)
             VALUES (?1, ?2, ?3, '', ?4, ?5, ?5)`,
          )
          .bind(`limit-${i}-${crypto.randomUUID()}`, coupleId, `アルバム ${i}`, owner.id, now),
      );
    }
    await db.batch(statements);

    await expect(call(router.album.create, { title: "101 件目" }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "LIMIT_REACHED",
    });

    const list = await call(router.album.list, {}, { context: contextFor(owner) });
    await call(router.album.delete, { id: list.items[0]!.id }, { context: contextFor(owner) });
    const created = await call(router.album.create, { title: "空きができた" }, { context: contextFor(owner) });
    expect(created.title).toBe("空きができた");
  });
});

describe("T7: coverPhotoId の検査と album.update", () => {
  it("別のアルバムの写真・別ペアの写真・存在しない id を coverPhotoId に渡すと INVALID_INPUT", async () => {
    const a = await createPair();
    const b = await createPair();
    const target = await call(router.album.create, { title: "対象" }, { context: contextFor(a.owner) });
    const otherOwn = await call(router.album.create, { title: "別のアルバム" }, { context: contextFor(a.owner) });
    const otherOwnPhoto = await insertAlbumPhoto(a.coupleId, otherOwn.id, 1_000);
    const otherPair = await call(router.album.create, { title: "別ペア" }, { context: contextFor(b.owner) });
    const otherPairPhoto = await insertAlbumPhoto(b.coupleId, otherPair.id, 1_000);

    for (const coverPhotoId of [otherOwnPhoto, otherPairPhoto, generateImageId()]) {
      await expect(
        call(router.album.update, { id: target.id, coverPhotoId }, { context: contextFor(a.owner) }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    const unchanged = await call(router.album.get, { id: target.id }, { context: contextFor(a.owner) });
    expect(unchanged.cover).toBeNull();
  });

  it("渡さなかった項目は変わらない。開始日を外すと終了日も外れる。既存の開始日より前の終了日は INVALID_INPUT", async () => {
    const { owner } = await createPair();
    const album = await call(
      router.album.create,
      { title: "元", note: "メモ", startDate: "2026-08-15", endDate: "2026-08-17" },
      { context: contextFor(owner) },
    );

    const titleOnly = await call(router.album.update, { id: album.id, title: "新" }, { context: contextFor(owner) });
    expect(titleOnly).toMatchObject({ title: "新", note: "メモ", startDate: "2026-08-15", endDate: "2026-08-17" });

    await expect(
      call(router.album.update, { id: album.id, endDate: "2026-08-10" }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const noStart = await call(router.album.update, { id: album.id, startDate: null }, { context: contextFor(owner) });
    expect(noStart).toMatchObject({ startDate: null, endDate: null });

    // 開始日が無い状態で終了日だけ渡すのも INVALID_INPUT
    await expect(
      call(router.album.update, { id: album.id, endDate: "2026-08-20" }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("album.updatePhoto は説明文だけ変える。他のアルバムの写真 id は NOT_FOUND", async () => {
    const { owner, coupleId } = await createPair();
    const album = await call(router.album.create, { title: "説明" }, { context: contextFor(owner) });
    const other = await call(router.album.create, { title: "他" }, { context: contextFor(owner) });
    const photoId = await insertAlbumPhoto(coupleId, album.id, 1_000);

    const updated = await call(
      router.album.updatePhoto,
      { id: album.id, photoId, caption: "夕暮れの伏見稲荷大社。" },
      { context: contextFor(owner) },
    );
    expect(updated).toMatchObject({ ref: { kind: "album", photoId }, caption: "夕暮れの伏見稲荷大社。", takenAt: 1_000 });

    await expect(
      call(router.album.updatePhoto, { id: other.id, photoId, caption: "x" }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("T9: photo.downloadUrl", () => {
  it("kind の両方で response-content-disposition 付きの URL と nisoine-YYYYMMDD-{imageId}.jpg の filename が返る", async () => {
    const { owner, coupleId } = await createPair();
    // 2026-08-16 00:00 JST = 2026-08-15 15:00 UTC
    const takenAt = Date.UTC(2026, 7, 15, 15, 0, 0) / 1000;
    const postId = await insertPostWithImages(coupleId, owner.id, takenAt, 2);
    const album = await call(router.album.create, { title: "保存" }, { context: contextFor(owner) });
    const photoId = await insertAlbumPhoto(coupleId, album.id, takenAt);

    const fromPost = await call(router.photo.downloadUrl, { kind: "post", postId, position: 1 }, { context: contextFor(owner) });
    const postKey = await db
      .prepare("SELECT key AS key FROM post_images WHERE post_id = ?1 AND position = 1")
      .bind(postId)
      .first<{ key: string }>();
    const postImageId = postKey!.key.slice(postKey!.key.lastIndexOf("/") + 1, -".jpg".length);
    expect(fromPost.filename).toBe(`nisoine-20260816-${postImageId}.jpg`);
    expect(fromPost.filename).toMatch(/^nisoine-\d{8}-[0-9A-HJKMNPQRSTVWXYZ]{26}\.jpg$/);
    expect(fromPost.url).toContain(postKey!.key);
    expect(new URL(fromPost.url).searchParams.get("response-content-disposition")).toBe(
      `attachment; filename="${fromPost.filename}"`,
    );
    expect(new URL(fromPost.url).searchParams.get("X-Amz-Expires")).toBe("300");

    const fromAlbum = await call(router.photo.downloadUrl, { kind: "album", photoId }, { context: contextFor(owner) });
    expect(fromAlbum.filename).toBe(`nisoine-20260816-${photoId}.jpg`);
    expect(new URL(fromAlbum.url).searchParams.get("response-content-disposition")).toBe(
      `attachment; filename="${fromAlbum.filename}"`,
    );
  });

  it("他ペアの ref・削除済み投稿・存在しない position は NOT_FOUND", async () => {
    const a = await createPair();
    const b = await createPair();
    const postId = await insertPostWithImages(a.coupleId, a.owner.id, 1_700_000_000, 1);
    const album = await call(router.album.create, { title: "A" }, { context: contextFor(a.owner) });
    const photoId = await insertAlbumPhoto(a.coupleId, album.id, 1_000);

    const ctxB = { context: contextFor(b.owner) };
    await expect(call(router.photo.downloadUrl, { kind: "post", postId, position: 0 }, ctxB)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(call(router.photo.downloadUrl, { kind: "album", photoId }, ctxB)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const ctxA = { context: contextFor(a.owner) };
    await expect(call(router.photo.downloadUrl, { kind: "post", postId, position: 1 }, ctxA)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await call(router.post.delete, { id: postId }, ctxA);
    await expect(call(router.photo.downloadUrl, { kind: "post", postId, position: 0 }, ctxA)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("ゲスト（未認証・デモペア）も保存 URL を取れる。album.list / photo.list も読める", async () => {
    const demoCoupleId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare("INSERT INTO couples (id, dating_date, is_demo, created_at) VALUES (?1, '2019-01-01', 1, ?2)")
      .bind(demoCoupleId, now)
      .run();
    const author = await createUser();
    const postId = await insertPostWithImages(demoCoupleId, author.id, now, 1);

    const ctx = { context: contextFor(null, demoCoupleId) };
    const list = await call(router.album.list, {}, ctx);
    expect(list.timeline.photoCount).toBe(1);
    const photos = await call(router.photo.list, {}, ctx);
    expect(photos.items).toHaveLength(1);
    const download = await call(router.photo.downloadUrl, { kind: "post", postId, position: 0 }, ctx);
    expect(download.filename).toMatch(/^nisoine-\d{8}-/);
  });
});

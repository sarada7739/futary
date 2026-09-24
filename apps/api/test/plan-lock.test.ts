import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { FREE_ALBUM_PHOTO_LIMIT, LOCK_GRACE_DAYS } from "@futary/contract";
import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";
import { generateImageId } from "../src/lib/ulid";
import { albumImageKeyFor } from "../src/lib/r2-signed-url";
import { LOCK_GRACE_SECONDS, resolvePlanState, unlockedPhotos } from "../src/lib/plan";

// プレミアムをやめたあと、無料枠を超える写真に鍵（047 4節 T1〜T7・T9・T11）。猶予の起点は 0節 #11。
// 鍵は「taken_at, id 昇順の先頭 30 枚に無い」で決める（0節 #13）。写真は R2 に直接置く（plan.test.ts と同じ）

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
  const id = `lock-user-${userSeq}-${crypto.randomUUID()}`;
  const name = `テストユーザー${userSeq}`;
  const email = `lock-user-${userSeq}-${crypto.randomUUID()}@example.com`;
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db
      .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)")
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

const DAY = 24 * 60 * 60;
const nowSec = () => Math.floor(Date.now() / 1000);

// couple_plans を直接書く（運営の SQL と同じ形。source と expires_at と updated_at を指定できる）
async function setPlanRow(
  coupleId: string,
  plan: string,
  source: "manual" | "stripe",
  expiresAt: number | null,
  updatedAt: number = nowSec(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO couple_plans (couple_id, plan, source, expires_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(couple_id) DO UPDATE SET plan = ?2, source = ?3, expires_at = ?4, updated_at = ?5`,
    )
    .bind(coupleId, plan, source, expiresAt, updatedAt)
    .run();
}

// paid だったが期限が (LOCK_GRACE_DAYS + 1) 日前に切れた = 鍵の後
async function setLocked(coupleId: string): Promise<void> {
  await setPlanRow(coupleId, "free", "stripe", nowSec() - (LOCK_GRACE_DAYS + 1) * DAY);
}

// 行と実体を直接作って枚数を積む。taken_at は base + i（古い順が決まる）。id の一覧を taken_at 順で返す
async function fillAlbum(coupleId: string, albumId: string, count: number, base: number): Promise<string[]> {
  const ids: string[] = [];
  const statements = [];
  for (let i = 0; i < count; i++) {
    const id = generateImageId();
    ids.push(id);
    const key = albumImageKeyFor(coupleId, id);
    await bucket.put(key, new Uint8Array(10), { httpMetadata: { contentType: "image/jpeg" } });
    statements.push(
      db
        .prepare(
          `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at)
           VALUES (?1, ?2, ?3, 100, 100, ?4, ?5, ?5)`,
        )
        .bind(id, albumId, key, `説明 ${i}`, base + i),
    );
  }
  if (statements.length > 0) await db.batch(statements);
  return ids;
}

async function uploadedPhoto(coupleId: string) {
  const imageId = generateImageId();
  await bucket.put(albumImageKeyFor(coupleId, imageId), new Uint8Array(100), { httpMetadata: { contentType: "image/jpeg" } });
  return { imageId, width: 800, height: 600 };
}

async function listAll(owner: TestUser, albumId: string) {
  const items = [];
  let cursor: string | undefined;
  do {
    const page = await call(router.photo.list, { albumId, cursor, limit: 60 }, { context: contextFor(owner) });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return items;
}

const LIMIT = FREE_ALBUM_PHOTO_LIMIT;

describe("047 T1: resolvePlanState（判定の 1 箇所。猶予の起点は 0節 #11）", () => {
  const now = 1_800_000_000;
  const GRACE = LOCK_GRACE_SECONDS;

  it("猶予は 30 日", () => {
    expect(LOCK_GRACE_DAYS).toBe(30);
    expect(GRACE).toBe(30 * DAY);
  });

  it("行なし → free・lockAt null", () => {
    expect(resolvePlanState(null, now)).toEqual({ plan: "free", lockAt: null, locked: false });
    expect(resolvePlanState(undefined, now)).toEqual({ plan: "free", lockAt: null, locked: false });
  });

  it("plan='free', source='stripe', expires_at NULL（Checkout 前の行。一度も paid になっていない）→ lockAt null", () => {
    expect(resolvePlanState({ plan: "free", source: "stripe", expires_at: null, updated_at: now - 100 * DAY }, now)).toEqual({
      plan: "free",
      lockAt: null,
      locked: false,
    });
  });

  it("paid 期限内 → paid。無期限の paid も paid", () => {
    expect(resolvePlanState({ plan: "paid", source: "stripe", expires_at: now + 1, updated_at: now }, now)).toEqual({ plan: "paid" });
    expect(resolvePlanState({ plan: "paid", source: "manual", expires_at: null, updated_at: now }, now)).toEqual({ plan: "paid" });
  });

  it("paid の期限切れ: +29 日は猶予中（lockAt = 期限 + 30 日）。+30 日ちょうどで locked", () => {
    const expires = now - 29 * DAY;
    const row = { plan: "paid", source: "stripe", expires_at: expires, updated_at: expires - 30 * DAY };
    expect(resolvePlanState(row, now)).toEqual({ plan: "free", lockAt: expires + GRACE, locked: false });
    expect(resolvePlanState(row, expires + GRACE - 1)).toEqual({ plan: "free", lockAt: expires + GRACE, locked: false });
    expect(resolvePlanState(row, expires + GRACE)).toEqual({ plan: "free", lockAt: expires + GRACE, locked: true });
  });

  it("Stripe の canceled（plan='free'・expires_at あり）も同じ起点", () => {
    const expires = now - 31 * DAY;
    const row = { plan: "free", source: "stripe", expires_at: expires, updated_at: now - 40 * DAY };
    expect(resolvePlanState(row, now)).toEqual({ plan: "free", lockAt: expires + GRACE, locked: true });
    expect(resolvePlanState(row, expires + DAY)).toEqual({ plan: "free", lockAt: expires + GRACE, locked: false });
  });

  it("手で free（source='manual'・expires_at 無し）は updated_at が起点", () => {
    const updated = now - 10 * DAY;
    const row = { plan: "free", source: "manual", expires_at: null, updated_at: updated };
    expect(resolvePlanState(row, now)).toEqual({ plan: "free", lockAt: updated + GRACE, locked: false });
    expect(resolvePlanState(row, updated + GRACE)).toEqual({ plan: "free", lockAt: updated + GRACE, locked: true });
  });

  it("未知の source・updated_at 無しの free の行は鍵を掛けない向きに倒す（0節 #11 のどれでもない形）", () => {
    expect(resolvePlanState({ plan: "free", source: "other", expires_at: null, updated_at: now - 100 * DAY }, now)).toEqual({
      plan: "free",
      lockAt: null,
      locked: false,
    });
    expect(resolvePlanState({ plan: "free", expires_at: null }, now)).toEqual({ plan: "free", lockAt: null, locked: false });
  });
});

describe("047 T2・T3・T7: locked で無料枠を超える分だけ url が null（アルバムをまたいで古い順に数える）", () => {
  it("T2: 2 つのアルバムに 25 + 15 = 40 枚。taken_at 昇順の 31〜40 枚目が url null・locked・caption 空。30 枚目までは URL あり", async () => {
    const { owner, coupleId } = await createPair();
    await setPlanRow(coupleId, "paid", "stripe", nowSec() + DAY);
    const a = await call(router.album.create, { title: "A" }, { context: contextFor(owner) });
    const b = await call(router.album.create, { title: "B" }, { context: contextFor(owner) });
    // A は 1,000〜1,024、B は 1,010〜1,024（交互に古い）。全体の昇順で 30 枚目までが鍵でない
    const aIds = await fillAlbum(coupleId, a.id, 25, 1_000);
    const bIds = await fillAlbum(coupleId, b.id, 15, 1_010);
    await setLocked(coupleId);

    const all = [...aIds.map((id, i) => ({ id, t: 1_000 + i })), ...bIds.map((id, i) => ({ id, t: 1_010 + i }))].sort(
      (x, y) => x.t - y.t || (x.id < y.id ? -1 : 1),
    );
    const unlockedIds = new Set(all.slice(0, LIMIT).map((x) => x.id));
    expect(unlockedIds.size).toBe(LIMIT);

    for (const album of [a, b]) {
      const items = await listAll(owner, album.id);
      for (const photo of items) {
        if (photo.ref.kind !== "album") throw new Error("album の ref のはず");
        if (unlockedIds.has(photo.ref.photoId)) {
          expect(photo.url, photo.ref.photoId).toMatch(/^https:\/\//);
          expect(photo.locked).toBe(false);
          expect(photo.caption).toMatch(/^説明 /);
        } else {
          expect(photo.url, photo.ref.photoId).toBeNull();
          expect(photo.locked).toBe(true);
          expect(photo.caption).toBe("");
        }
        // マスの形は保つ
        expect(photo.width).toBe(100);
        expect(photo.takenAt).toBeGreaterThan(0);
      }
    }
    const aItems = await listAll(owner, a.id);
    const bItems = await listAll(owner, b.id);
    expect(aItems.filter((p) => p.locked).length + bItems.filter((p) => p.locked).length).toBe(10);
    // lib の unlockedPhotos も同じ 30 枚
    expect(new Set((await unlockedPhotos(db, coupleId)).map((p) => p.id))).toEqual(unlockedIds);
  });

  it("T3: 鍵の写真の photo.downloadUrl → NOT_FOUND。鍵でない写真は取れる。鍵の写真は updatePhoto も NOT_FOUND", async () => {
    const { owner, coupleId } = await createPair();
    await setPlanRow(coupleId, "paid", "stripe", nowSec() + DAY);
    const a = await call(router.album.create, { title: "A" }, { context: contextFor(owner) });
    const ids = await fillAlbum(coupleId, a.id, LIMIT + 2, 1_000);
    await setLocked(coupleId);

    const first = await call(router.photo.downloadUrl, { kind: "album", photoId: ids[0]! }, { context: contextFor(owner) });
    expect(first.url).toMatch(/^https:\/\//);
    await expect(
      call(router.photo.downloadUrl, { kind: "album", photoId: ids[LIMIT]! }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(router.album.updatePhoto, { id: a.id, photoId: ids[LIMIT + 1]!, caption: "x" }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("T7: 猶予中は全部の URL が返り、couple.get の planState.lockAt が期限 + 30 日", async () => {
    const { owner, partner, coupleId } = await createPair();
    await setPlanRow(coupleId, "paid", "stripe", nowSec() + DAY);
    const a = await call(router.album.create, { title: "A" }, { context: contextFor(owner) });
    await fillAlbum(coupleId, a.id, LIMIT + 5, 1_000);
    const expires = nowSec() - DAY;
    await setPlanRow(coupleId, "free", "stripe", expires);

    const items = await listAll(owner, a.id);
    expect(items).toHaveLength(LIMIT + 5);
    expect(items.every((p) => p.url !== null && p.locked === false)).toBe(true);

    const couple = await call(router.couple.get, undefined, { context: contextFor(partner) });
    expect(couple.plan).toBe("free");
    expect(couple.planState).toEqual({ plan: "free", lockAt: expires + LOCK_GRACE_SECONDS, locked: false });
    // used は全部（鍵の判定とは無関係に数える）
    expect(couple.albumQuota).toEqual({ limit: LIMIT, used: LIMIT + 5 });
  });

  it("locked の couple.get: planState.locked が true。paid なら { plan: 'paid' }", async () => {
    const { owner, coupleId } = await createPair();
    await setLocked(coupleId);
    const locked = await call(router.couple.get, undefined, { context: contextFor(owner) });
    expect(locked.planState).toMatchObject({ plan: "free", locked: true });
    await setPlanRow(coupleId, "paid", "stripe", nowSec() + DAY);
    const paid = await call(router.couple.get, undefined, { context: contextFor(owner) });
    expect(paid.planState).toEqual({ plan: "paid" });
  });
});

describe("047 T4: locked でカバーが鍵の写真なら、鍵でない中でいちばん新しいものに倒す", () => {
  it("album.get / album.list とも。鍵でない写真が無いアルバムは cover null", async () => {
    const { owner, coupleId } = await createPair();
    await setPlanRow(coupleId, "paid", "stripe", nowSec() + DAY);
    const a = await call(router.album.create, { title: "A" }, { context: contextFor(owner) });
    const b = await call(router.album.create, { title: "B" }, { context: contextFor(owner) });
    const aIds = await fillAlbum(coupleId, a.id, LIMIT, 1_000); // 全部鍵でない
    const bIds = await fillAlbum(coupleId, b.id, 3, 2_000); // 全部鍵（31〜33 枚目）
    // A のカバーを鍵でない最古の写真に（倒されない）。カバー未指定なら最新（鍵でない中で最新 = aIds[29]）
    await call(router.album.update, { id: a.id, title: "A", note: "", startDate: null, endDate: null }, { context: contextFor(owner) });
    await db.prepare("UPDATE albums SET cover_photo_id = ?1 WHERE id = ?2").bind(bIds[2], b.id).run();
    await setLocked(coupleId);

    const gotA = await call(router.album.get, { id: a.id }, { context: contextFor(owner) });
    expect(gotA.cover?.url).toContain(encodeURIComponent(aIds[LIMIT - 1]!).replace(/%2F/g, "/"));
    expect(gotA.photoCount).toBe(LIMIT);
    const gotB = await call(router.album.get, { id: b.id }, { context: contextFor(owner) });
    expect(gotB.cover).toBeNull();
    expect(gotB.photoCount).toBe(3);

    const list = await call(router.album.list, {}, { context: contextFor(owner) });
    expect(list.items.find((x) => x.id === b.id)?.cover).toBeNull();
    expect(list.items.find((x) => x.id === a.id)?.cover).not.toBeNull();

    // 鍵でない写真が混ざるアルバム: B に古い写真を 1 枚足して（全体で 31 枚。B の古い 1 枚は鍵でない側に入る）
    // カバー（鍵）はその 1 枚に倒れる
    const [oldId] = await fillAlbum(coupleId, b.id, 1, 500);
    const gotB2 = await call(router.album.get, { id: b.id }, { context: contextFor(owner) });
    expect(gotB2.cover?.url).toContain(oldId!);
  });
});

describe("047 T5・T6: 鍵の間の削除と追加", () => {
  it("T5: 40 枚で locked → 10 枚消して 30 枚 → 鍵が全部外れる。paid に戻す → 外れる", async () => {
    const { owner, coupleId } = await createPair();
    await setPlanRow(coupleId, "paid", "stripe", nowSec() + DAY);
    const a = await call(router.album.create, { title: "A" }, { context: contextFor(owner) });
    const ids = await fillAlbum(coupleId, a.id, LIMIT + 10, 1_000);
    await setLocked(coupleId);
    expect((await listAll(owner, a.id)).filter((p) => p.locked)).toHaveLength(10);

    // 古い側を 10 枚消す（残る 30 枚は全部「先頭 30」になる）
    await call(router.album.removePhotos, { id: a.id, photoIds: ids.slice(0, 10) }, { context: contextFor(owner) });
    const afterRemove = await listAll(owner, a.id);
    expect(afterRemove).toHaveLength(LIMIT);
    expect(afterRemove.every((p) => !p.locked && p.url !== null)).toBe(true);

    // もう一度 locked の状態で 5 枚足して（直接）鍵が付き、paid に戻すと外れる
    await fillAlbum(coupleId, a.id, 5, 3_000);
    expect((await listAll(owner, a.id)).filter((p) => p.locked)).toHaveLength(5);
    await setPlanRow(coupleId, "paid", "stripe", nowSec() + DAY);
    expect((await listAll(owner, a.id)).every((p) => !p.locked && p.url !== null)).toBe(true);
  });

  it("T6: locked で addPhotos → PLAN_LIMIT（used が鍵を含む）。album.create の cover も PLAN_LIMIT", async () => {
    const { owner, coupleId } = await createPair();
    await setPlanRow(coupleId, "paid", "stripe", nowSec() + DAY);
    const a = await call(router.album.create, { title: "A" }, { context: contextFor(owner) });
    await fillAlbum(coupleId, a.id, LIMIT + 10, 1_000);
    await setLocked(coupleId);

    const photo = await uploadedPhoto(coupleId);
    await expect(call(router.album.addPhotos, { id: a.id, photos: [photo] }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "PLAN_LIMIT",
    });
    await expect(
      call(router.album.create, { title: "B", cover: await uploadedPhoto(coupleId) }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });
  });
});

describe("047 T9: 別ペアの写真を数えない（couple_id スコープ）", () => {
  it("locked のペアの隣に 40 枚の paid のペアがあっても、自分の 20 枚は全部見える。相手のペアの鍵にも影響しない", async () => {
    const mine = await createPair();
    const other = await createPair();
    await setPlanRow(mine.coupleId, "paid", "stripe", nowSec() + DAY);
    await setPlanRow(other.coupleId, "paid", "stripe", nowSec() + DAY);
    const a = await call(router.album.create, { title: "mine" }, { context: contextFor(mine.owner) });
    const o = await call(router.album.create, { title: "other" }, { context: contextFor(other.owner) });
    // 相手の写真の方が古い（数えてしまうと自分の 20 枚が全部鍵になる）
    await fillAlbum(other.coupleId, o.id, 40, 100);
    await fillAlbum(mine.coupleId, a.id, 20, 1_000);
    await setLocked(mine.coupleId);

    const items = await listAll(mine.owner, a.id);
    expect(items).toHaveLength(20);
    expect(items.every((p) => !p.locked && p.url !== null)).toBe(true);
    expect((await unlockedPhotos(db, mine.coupleId)).map((p) => p.album_id)).toEqual(Array(20).fill(a.id));
    // 相手（paid）は 40 枚とも見える
    const theirs = await listAll(other.owner, o.id);
    expect(theirs.every((p) => !p.locked)).toBe(true);
    // 自分の photo.downloadUrl で相手の写真は NOT_FOUND のまま（鍵の判定が先に通っても存在を教えない）
    const theirRef = theirs[0]!.ref;
    await expect(call(router.photo.downloadUrl, theirRef, { context: contextFor(mine.owner) })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("047 T11: 鍵の側を IN に入れない（1 ペアの写真が多くても 1 文のパラメータは増えない）", () => {
  it("locked で 200 件のアルバム × 3 枚（600 枚）でも photo.list の 1 ページが通り、鍵でない側は 30 個", async () => {
    const { owner, coupleId } = await createPair();
    await setPlanRow(coupleId, "paid", "stripe", nowSec() + DAY);
    const now = nowSec();
    const albumIds: string[] = [];
    const statements = [];
    for (let i = 0; i < 200; i++) {
      const albumId = `lock-album-${i}-${crypto.randomUUID()}`;
      albumIds.push(albumId);
      statements.push(
        db
          .prepare(
            `INSERT INTO albums (id, couple_id, title, note, created_by, created_at, updated_at)
             VALUES (?1, ?2, ?3, '', ?4, ?5, ?5)`,
          )
          .bind(albumId, coupleId, `アルバム ${i}`, owner.id, now),
      );
      for (let j = 0; j < 3; j++) {
        const id = generateImageId();
        statements.push(
          db
            .prepare(
              `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at)
               VALUES (?1, ?2, ?3, 100, 100, '', ?4, ?4)`,
            )
            .bind(id, albumId, albumImageKeyFor(coupleId, id), 10_000 + i * 3 + j),
        );
      }
    }
    await db.batch(statements);
    await setLocked(coupleId);

    const unlocked = await unlockedPhotos(db, coupleId);
    expect(unlocked).toHaveLength(LIMIT);
    // 先頭 10 件のアルバム（taken_at が小さい）の 30 枚が鍵でない
    expect(new Set(unlocked.map((p) => p.album_id))).toEqual(new Set(albumIds.slice(0, 10)));

    const firstPage = await call(router.photo.list, { albumId: albumIds[0]!, limit: 60 }, { context: contextFor(owner) });
    expect(firstPage.items.every((p) => !p.locked)).toBe(true);
    const lastPage = await call(router.photo.list, { albumId: albumIds[199]!, limit: 60 }, { context: contextFor(owner) });
    expect(lastPage.items).toHaveLength(3);
    expect(lastPage.items.every((p) => p.locked && p.url === null)).toBe(true);

    // album.list（200 件）も 1 度の鍵の文脈で通る。鍵しか無いアルバムのカバーは null、先頭 10 件は有る
    const list = await call(router.album.list, {}, { context: contextFor(owner) });
    expect(list.items).toHaveLength(200);
    expect(list.items.filter((x) => x.cover !== null)).toHaveLength(10);
    expect(list.items.every((x) => x.photoCount === 3)).toBe(true);
  });
});

describe("047 T12: 削除済みアルバムの写真は「鍵でない 30 枚」の枠を食わない（unlockedPhotos の albums.deleted_at IS NULL）", () => {
  it("削除済みアルバム（deleted_at あり）に古い写真の行を直接 30 枚置いても、生きているアルバムの 20 枚が全部鍵でない", async () => {
    const { owner, coupleId } = await createPair();
    await setPlanRow(coupleId, "paid", "stripe", nowSec() + DAY);
    const live = await call(router.album.create, { title: "生きている" }, { context: contextFor(owner) });
    const dead = await call(router.album.create, { title: "消した" }, { context: contextFor(owner) });
    // 消したアルバムの方が古い写真（枠を食うなら生きている 20 枚が全部鍵になる）。
    // album.delete は写真の行を物理削除するので、deleted_at を SQL で直接立てて行を残す
    const deadIds = await fillAlbum(coupleId, dead.id, LIMIT, 100);
    const liveIds = await fillAlbum(coupleId, live.id, 20, 1_000);
    await db.prepare("UPDATE albums SET deleted_at = ?1 WHERE id = ?2").bind(nowSec(), dead.id).run();
    await setLocked(coupleId);

    const unlocked = await unlockedPhotos(db, coupleId);
    expect(unlocked.map((p) => p.id).sort()).toEqual([...liveIds].sort());
    expect(unlocked.some((p) => deadIds.includes(p.id))).toBe(false);

    const items = await listAll(owner, live.id);
    expect(items).toHaveLength(20);
    expect(items.every((p) => !p.locked && p.url !== null)).toBe(true);
    // 削除済みのアルバム自体は NOT_FOUND のまま
    await expect(call(router.photo.list, { albumId: dead.id }, { context: contextFor(owner) })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

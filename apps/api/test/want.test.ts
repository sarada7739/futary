import { env } from "cloudflare:test";
import { call } from "@orpc/server";
import { afterEach, describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { Bindings } from "../src/index";
import type { RpcContext } from "../src/context";
import { generateImageId } from "../src/lib/ulid";
import { wantImageKeyFor, wantImagePrefixFor } from "../src/lib/r2-signed-url";
import { setLinkPreviewFetchForTest } from "../src/procedures/want";
import { normalizeWantUrl } from "../src/lib/want-url";
import type { FetchLike } from "../src/lib/link-preview";

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

async function createCouple(user: TestUser) {
  return call(router.couple.create, {}, { context: contextFor(user) });
}

// 2人のペアを作る（招待を発行して相手が受け入れる）
async function createPair(): Promise<{ owner: TestUser; partner: TestUser; coupleId: string }> {
  const owner = await createUser();
  const partner = await createUser();
  const couple = await createCouple(owner);
  const invite = await call(router.invite.issue, undefined, { context: contextFor(owner) });
  await call(router.invite.accept, { code: invite.code }, { context: contextFor(partner) });
  return { owner, partner, coupleId: couple.id };
}

// want.uploadUrl を経由せず R2 に直接オブジェクトを置く（post.test.ts の uploadTestImage と同じ形）
async function uploadTestWantImage(coupleId: string, sizeBytes = 100, contentType = "image/jpeg"): Promise<string> {
  const imageId = generateImageId();
  await bucket.put(wantImageKeyFor(coupleId, imageId, "jpg"), new Uint8Array(sizeBytes), {
    httpMetadata: { contentType },
  });
  return imageId;
}

const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
// Response に渡せるよう ArrayBuffer で返す
function jpegBytes(size: number): ArrayBuffer {
  const out = new Uint8Array(size);
  out.set(JPEG_HEAD);
  return out.buffer;
}

// 外へは出ない fetch。呼ばれた URL を記録する
function stubPreviewFetch(routes: Record<string, () => Response>): { calls: string[] } {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    calls.push(url);
    const route = routes[url];
    return route ? route() : new Response("not found", { status: 404 });
  };
  setLinkPreviewFetchForTest(impl);
  return { calls };
}

afterEach(() => {
  setLinkPreviewFetchForTest(undefined);
});

async function listR2Keys(prefix: string): Promise<string[]> {
  const listed = await bucket.list({ prefix });
  return listed.objects.map((o) => o.key);
}

describe("want.create / want.list（基本）", () => {
  it("題名だけで作れる。自分のタブに出て isMine が true・ownerName が自分の名前", async () => {
    const { owner } = await createPair();
    stubPreviewFetch({});
    const created = await call(router.want.create, { title: "新しいマグカップ" }, { context: contextFor(owner) });

    expect(created).toMatchObject({
      title: "新しいマグカップ",
      url: null,
      note: "",
      image: null,
      isMine: true,
      ownerName: owner.name,
      obtainedAt: null,
    });

    const mine = await call(router.want.list, { ownerSide: "me" }, { context: contextFor(owner) });
    expect(mine.ownerName).toBe(owner.name);
    expect(mine.items.map((w) => w.id)).toEqual([created.id]);
  });

  it("相手のタブでは isMine が false で、ownerName は相手の名前。自分のタブには相手の分が出ない", async () => {
    const { owner, partner } = await createPair();
    stubPreviewFetch({});
    const ownerWant = await call(router.want.create, { title: "自分のもの" }, { context: contextFor(owner) });
    const partnerWant = await call(router.want.create, { title: "相手のもの" }, { context: contextFor(partner) });

    const partnerSide = await call(router.want.list, { ownerSide: "partner" }, { context: contextFor(owner) });
    expect(partnerSide.ownerName).toBe(partner.name);
    expect(partnerSide.items.map((w) => w.id)).toEqual([partnerWant.id]);
    expect(partnerSide.items[0]?.isMine).toBe(false);

    const mySide = await call(router.want.list, { ownerSide: "me" }, { context: contextFor(owner) });
    expect(mySide.items.map((w) => w.id)).toEqual([ownerWant.id]);
  });

  it("1人のペア: partner 側は items が空で ownerName が null（画面はこれでタブを出さない）", async () => {
    const owner = await createUser();
    await createCouple(owner);
    const result = await call(router.want.list, { ownerSide: "partner" }, { context: contextFor(owner) });
    expect(result).toEqual({ items: [], ownerName: null });
  });

  it("新しい順。手に入れたものは末尾にまとまる", async () => {
    const { owner } = await createPair();
    stubPreviewFetch({});
    const a = await call(router.want.create, { title: "A" }, { context: contextFor(owner) });
    const b = await call(router.want.create, { title: "B" }, { context: contextFor(owner) });
    const c = await call(router.want.create, { title: "C" }, { context: contextFor(owner) });
    // created_at が同じ秒になりうるため、並びは created_at を明示的にずらす
    await db.prepare("UPDATE wants SET created_at = ?1 WHERE id = ?2").bind(1000, a.id).run();
    await db.prepare("UPDATE wants SET created_at = ?1 WHERE id = ?2").bind(2000, b.id).run();
    await db.prepare("UPDATE wants SET created_at = ?1 WHERE id = ?2").bind(3000, c.id).run();
    await call(router.want.setObtained, { id: c.id, obtained: true }, { context: contextFor(owner) });

    const result = await call(router.want.list, { ownerSide: "me" }, { context: contextFor(owner) });
    expect(result.items.map((w) => w.title)).toEqual(["B", "A", "C"]);
    expect(result.items[2]?.obtainedAt).not.toBeNull();
  });

  it("題名も URL も無いと BAD_REQUEST（契約の refine）", async () => {
    const { owner } = await createPair();
    await expect(call(router.want.create, { note: "メモだけ" }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("http/https 以外の URL は BAD_REQUEST（fetch にも行かない。T1）", async () => {
    const { owner } = await createPair();
    const { calls } = stubPreviewFetch({});
    for (const url of ["javascript:alert(1)", "ftp://example.com/x", "file:///etc/passwd", "not a url"]) {
      await expect(call(router.want.create, { url }, { context: contextFor(owner) })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("IP リテラル・localhost の URL は fetch に行かず、画像無し・ホスト名の題名で保存される（T1）", async () => {
    const { owner } = await createPair();
    const { calls } = stubPreviewFetch({});
    const created = await call(router.want.create, { url: "http://127.0.0.1:8787/admin" }, { context: contextFor(owner) });
    expect(calls).toHaveLength(0);
    expect(created.image).toBeNull();
    expect(created.title).toBe("127.0.0.1");
    expect(created.url).toBe("http://127.0.0.1:8787/admin");
  });
});

describe("want.create: URL からの自動取得", () => {
  const page = "https://shop.example.com/item/42";
  const imageUrl = "https://cdn.example.com/item.jpg";
  const html = `<html><head><meta property="og:title" content="ペアのマグカップ"><meta property="og:image" content="${imageUrl}"></head></html>`;

  it("url だけで作ると og:title が題名になり、画像が R2（wants/ 接頭辞）に置かれて署名付き URL で返る", async () => {
    const { owner, coupleId } = await createPair();
    const { calls } = stubPreviewFetch({
      [page]: () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
      [imageUrl]: () => new Response(jpegBytes(2048), { headers: { "content-type": "image/jpeg" } }),
    });

    const created = await call(router.want.create, { url: page }, { context: contextFor(owner) });

    expect(calls).toEqual([page, imageUrl]);
    expect(created.title).toBe("ペアのマグカップ");
    expect(created.url).toBe(page);
    expect(created.image?.url).toContain(`/test-bucket/${wantImagePrefixFor(coupleId)}`);
    expect(created.image?.url).toContain(".jpg?");

    const keys = await listR2Keys(wantImagePrefixFor(coupleId));
    expect(keys).toHaveLength(1);
    const object = await bucket.get(keys[0] as string);
    expect(object?.httpMetadata?.contentType).toBe("image/jpeg");
    expect(object?.size).toBe(2048);
  });

  it("利用者が題名を書いていれば og:title で上書きしない", async () => {
    const { owner } = await createPair();
    stubPreviewFetch({
      [page]: () => new Response(html, { headers: { "content-type": "text/html" } }),
      [imageUrl]: () => new Response(jpegBytes(100), { headers: { "content-type": "image/jpeg" } }),
    });
    const created = await call(router.want.create, { url: page, title: "自分で書いた題名" }, { context: contextFor(owner) });
    expect(created.title).toBe("自分で書いた題名");
    expect(created.image).not.toBeNull();
  });

  it("画像が取れなくても 200 で保存される（1MB 超・許可外の型・ページ 520）。T3", async () => {
    const { owner, coupleId } = await createPair();
    const cases: Array<() => Response> = [
      () => new Response(jpegBytes(1024 * 1024 + 1), { headers: { "content-type": "image/jpeg" } }),
      () => new Response(new Uint8Array([0x47, 0x49, 0x46, 0x38]).buffer, { headers: { "content-type": "image/gif" } }),
    ];
    for (const imageRoute of cases) {
      stubPreviewFetch({
        [page]: () => new Response(html, { headers: { "content-type": "text/html" } }),
        [imageUrl]: imageRoute,
      });
      const created = await call(router.want.create, { url: page }, { context: contextFor(owner) });
      expect(created.image).toBeNull();
      expect(created.title).toBe("ペアのマグカップ");
    }
    stubPreviewFetch({ [page]: () => new Response("error code: 520", { status: 520 }) });
    const created = await call(router.want.create, { url: page }, { context: contextFor(owner) });
    expect(created.image).toBeNull();
    // 題名が無く og:title も取れない → ホスト名
    expect(created.title).toBe("shop.example.com");
    expect(await listR2Keys(wantImagePrefixFor(coupleId))).toHaveLength(0);
  });

  it("手で付けた画像（imageId）があれば、URL があっても画像は取りに行かない（題名が無ければ題名だけ取る）", async () => {
    const { owner, coupleId } = await createPair();
    const imageId = await uploadTestWantImage(coupleId);
    const { calls } = stubPreviewFetch({
      [page]: () => new Response(html, { headers: { "content-type": "text/html" } }),
      [imageUrl]: () => new Response(jpegBytes(100), { headers: { "content-type": "image/jpeg" } }),
    });
    const created = await call(router.want.create, { url: page, imageId }, { context: contextFor(owner) });
    expect(calls).toEqual([page]);
    expect(created.title).toBe("ペアのマグカップ");
    expect(created.image?.url).toContain(`${imageId}.jpg`);
  });

  it("手で付けた画像と題名の両方があれば、外へ一切行かない", async () => {
    const { owner, coupleId } = await createPair();
    const imageId = await uploadTestWantImage(coupleId);
    const { calls } = stubPreviewFetch({});
    await call(router.want.create, { url: page, title: "題名", imageId }, { context: contextFor(owner) });
    expect(calls).toHaveLength(0);
  });
});

describe("want.create: 手で付けた画像の検証（post.create と同じ）", () => {
  it("実体の無い imageId は INVALID_INPUT", async () => {
    const { owner } = await createPair();
    await expect(
      call(router.want.create, { title: "x", imageId: generateImageId() }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("Content-Type が JPEG でない実体は INVALID_INPUT で、実体は削除される", async () => {
    const { owner, coupleId } = await createPair();
    const imageId = await uploadTestWantImage(coupleId, 100, "image/png");
    await expect(call(router.want.create, { title: "x", imageId }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(await bucket.head(wantImageKeyFor(coupleId, imageId, "jpg"))).toBeNull();
  });

  it("同じ imageId を二度使うと INVALID_INPUT（image_key の UNIQUE）", async () => {
    const { owner, coupleId } = await createPair();
    const imageId = await uploadTestWantImage(coupleId);
    await call(router.want.create, { title: "1回目", imageId }, { context: contextFor(owner) });
    await expect(call(router.want.create, { title: "2回目", imageId }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("本人以外は触れない（T4）: update / setImage / setObtained / delete は NOT_FOUND", () => {
  it("相手の行に対する4手続きは、存在しない id と同じ NOT_FOUND", async () => {
    const { owner, partner, coupleId } = await createPair();
    stubPreviewFetch({});
    const ownerWant = await call(router.want.create, { title: "自分のもの" }, { context: contextFor(owner) });
    const imageId = await uploadTestWantImage(coupleId);
    const missing = crypto.randomUUID();

    const attempts = [
      (id: string) =>
        call(router.want.update, { id, title: "書き換え", url: null, note: "" }, { context: contextFor(partner) }),
      (id: string) => call(router.want.setImage, { id, imageId }, { context: contextFor(partner) }),
      (id: string) => call(router.want.setImage, { id, imageId: null }, { context: contextFor(partner) }),
      (id: string) => call(router.want.setObtained, { id, obtained: true }, { context: contextFor(partner) }),
      (id: string) => call(router.want.delete, { id }, { context: contextFor(partner) }),
    ];
    for (const attempt of attempts) {
      await expect(attempt(ownerWant.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(attempt(missing)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }

    // 何も変わっていない
    const row = await db.prepare("SELECT title, obtained_at, deleted_at, image_key FROM wants WHERE id = ?1").bind(ownerWant.id).first();
    expect(row).toEqual({ title: "自分のもの", obtained_at: null, deleted_at: null, image_key: null });
  });
});

describe("couple_id スコープ（T5）", () => {
  it("別ペアの行は list に出ず、id を知っていても触れない", async () => {
    const pairA = await createPair();
    const pairB = await createPair();
    stubPreviewFetch({});
    const wantA = await call(router.want.create, { title: "A のもの" }, { context: contextFor(pairA.owner) });
    await call(router.want.create, { title: "B のもの" }, { context: contextFor(pairB.owner) });

    const mine = await call(router.want.list, { ownerSide: "me" }, { context: contextFor(pairB.owner) });
    expect(mine.items.map((w) => w.title)).toEqual(["B のもの"]);
    const partnerSide = await call(router.want.list, { ownerSide: "partner" }, { context: contextFor(pairB.owner) });
    expect(partnerSide.items.map((w) => w.title)).not.toContain("A のもの");

    await expect(
      call(router.want.update, { id: wantA.id, title: "乗っ取り", url: null, note: "" }, { context: contextFor(pairB.owner) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(router.want.setObtained, { id: wantA.id, obtained: true }, { context: contextFor(pairB.owner) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(call(router.want.delete, { id: wantA.id }, { context: contextFor(pairB.owner) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("デモ閲覧（未認証）は partner = slot 1・me = slot 2 の人を読める（isMine は常に false）が、書けない", async () => {
    const { owner, partner, coupleId } = await createPair();
    await db.prepare("UPDATE couples SET is_demo = 1 WHERE id = ?1").bind(coupleId).run();
    stubPreviewFetch({});
    await call(router.want.create, { title: "slot 1 のもの" }, { context: contextFor(owner) });
    await call(router.want.create, { title: "slot 2 のもの" }, { context: contextFor(partner) });

    const partnerSide = await call(router.want.list, { ownerSide: "partner" }, { context: contextFor(null, coupleId) });
    expect(partnerSide.ownerName).toBe(owner.name);
    expect(partnerSide.items.map((w) => w.title)).toEqual(["slot 1 のもの"]);
    expect(partnerSide.items[0]?.isMine).toBe(false);
    const mySide = await call(router.want.list, { ownerSide: "me" }, { context: contextFor(null, coupleId) });
    expect(mySide.ownerName).toBe(partner.name);
    expect(mySide.items.map((w) => w.title)).toEqual(["slot 2 のもの"]);
    expect(mySide.items[0]?.isMine).toBe(false);

    await expect(call(router.want.create, { title: "書けない" }, { context: contextFor(null, coupleId) })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("上限 100 件（T6）", () => {
  it("101 件目は LIMIT_REACHED。手に入れた分も数える。削除した分は数えない。相手の分は数えない", async () => {
    const { owner, partner, coupleId } = await createPair();
    stubPreviewFetch({});
    const now = Math.floor(Date.now() / 1000);
    // 99 件を直接入れる（うち 1 件は手に入れた）
    const statements = [];
    for (let i = 0; i < 99; i++) {
      statements.push(
        db
          .prepare(
            "INSERT INTO wants (id, couple_id, owner_id, title, note, created_at, obtained_at) VALUES (?1, ?2, ?3, ?4, '', ?5, ?6)",
          )
          .bind(`w-${i}-${crypto.randomUUID()}`, coupleId, owner.id, `item ${i}`, now, i === 0 ? now : null),
      );
    }
    await db.batch(statements);

    const hundredth = await call(router.want.create, { title: "100 件目" }, { context: contextFor(owner) });
    await expect(call(router.want.create, { title: "101 件目" }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "LIMIT_REACHED",
    });
    // 相手は自分の枠を持つ
    await call(router.want.create, { title: "相手の 1 件目" }, { context: contextFor(partner) });
    // 1 件消せばまた作れる
    await call(router.want.delete, { id: hundredth.id }, { context: contextFor(owner) });
    await call(router.want.create, { title: "また 100 件目" }, { context: contextFor(owner) });
  });
});

describe("want.update / setImage / setObtained / delete（本人）", () => {
  it("update: 題名・URL・メモを書き換える。URL は正規化され、画像は取り直さない", async () => {
    const { owner } = await createPair();
    const { calls } = stubPreviewFetch({});
    const created = await call(router.want.create, { title: "前" }, { context: contextFor(owner) });
    const updated = await call(
      router.want.update,
      { id: created.id, title: "後", url: "https://www.amazon.co.jp/dp/B0HJBHHXK2/?tag=x&th=1", note: "メモ" },
      { context: contextFor(owner) },
    );
    expect(updated).toMatchObject({ title: "後", url: "https://www.amazon.co.jp/dp/B0HJBHHXK2", note: "メモ", image: null });
    expect(calls).toHaveLength(0);
    const cleared = await call(router.want.update, { id: created.id, title: "後", url: null, note: "" }, { context: contextFor(owner) });
    expect(cleared.url).toBeNull();
  });

  it("setImage: 付ける・付け替える・外す。前の実体は消える", async () => {
    const { owner, coupleId } = await createPair();
    stubPreviewFetch({});
    const created = await call(router.want.create, { title: "x" }, { context: contextFor(owner) });
    const first = await uploadTestWantImage(coupleId);
    const withImage = await call(router.want.setImage, { id: created.id, imageId: first }, { context: contextFor(owner) });
    expect(withImage.image?.url).toContain(`${first}.jpg`);

    const second = await uploadTestWantImage(coupleId);
    const replaced = await call(router.want.setImage, { id: created.id, imageId: second }, { context: contextFor(owner) });
    expect(replaced.image?.url).toContain(`${second}.jpg`);
    expect(await bucket.head(wantImageKeyFor(coupleId, first, "jpg"))).toBeNull();

    const removed = await call(router.want.setImage, { id: created.id, imageId: null }, { context: contextFor(owner) });
    expect(removed.image).toBeNull();
    expect(await bucket.head(wantImageKeyFor(coupleId, second, "jpg"))).toBeNull();
    expect(await listR2Keys(wantImagePrefixFor(coupleId))).toHaveLength(0);
  });

  it("setImage: 実体の無い imageId は INVALID_INPUT で、行は変わらない", async () => {
    const { owner } = await createPair();
    stubPreviewFetch({});
    const created = await call(router.want.create, { title: "x" }, { context: contextFor(owner) });
    await expect(
      call(router.want.setImage, { id: created.id, imageId: generateImageId() }, { context: contextFor(owner) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const mine = await call(router.want.list, { ownerSide: "me" }, { context: contextFor(owner) });
    expect(mine.items[0]?.image).toBeNull();
  });

  it("setObtained: 同じ値を2回送っても結果が変わらない（冪等）。false で戻る", async () => {
    const { owner } = await createPair();
    stubPreviewFetch({});
    const created = await call(router.want.create, { title: "x" }, { context: contextFor(owner) });
    const once = await call(router.want.setObtained, { id: created.id, obtained: true }, { context: contextFor(owner) });
    const twice = await call(router.want.setObtained, { id: created.id, obtained: true }, { context: contextFor(owner) });
    expect(once.obtainedAt).not.toBeNull();
    expect(twice.obtainedAt).toBe(once.obtainedAt);
    const back = await call(router.want.setObtained, { id: created.id, obtained: false }, { context: contextFor(owner) });
    expect(back.obtainedAt).toBeNull();
  });

  it("delete: 論理削除され一覧から消える。R2 の実体は物理削除。二度目は NOT_FOUND", async () => {
    const { owner, coupleId } = await createPair();
    stubPreviewFetch({});
    const imageId = await uploadTestWantImage(coupleId);
    const created = await call(router.want.create, { title: "x", imageId }, { context: contextFor(owner) });

    await call(router.want.delete, { id: created.id }, { context: contextFor(owner) });

    const mine = await call(router.want.list, { ownerSide: "me" }, { context: contextFor(owner) });
    expect(mine.items).toHaveLength(0);
    expect(await bucket.head(wantImageKeyFor(coupleId, imageId, "jpg"))).toBeNull();
    const row = await db.prepare("SELECT deleted_at, image_key FROM wants WHERE id = ?1").bind(created.id).first<{
      deleted_at: number | null;
      image_key: string | null;
    }>();
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.image_key).toBeNull();
    await expect(call(router.want.delete, { id: created.id }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("uploadUrl: wants/ 接頭辞の jpg の鍵に対する署名付き PUT URL を返す", async () => {
    const { owner, coupleId } = await createPair();
    const result = await call(router.want.uploadUrl, { contentType: "image/jpeg" }, { context: contextFor(owner) });
    expect(result.url).toContain(`/test-bucket/${wantImagePrefixFor(coupleId)}${result.imageId}.jpg?`);
  });
});

describe("Amazon の URL の正規化（T8）", () => {
  it.each([
    ["https://www.amazon.co.jp/dp/B0HJBHHXK2/", "https://www.amazon.co.jp/dp/B0HJBHHXK2"],
    ["https://www.amazon.co.jp/dp/B0HJBHHXK2/?tag=abc-22&th=1", "https://www.amazon.co.jp/dp/B0HJBHHXK2"],
    ["https://www.amazon.co.jp/Apple-iPhone-18-Pro-Max/dp/B0HJBHHXK2?ref=x#y", "https://www.amazon.co.jp/dp/B0HJBHHXK2"],
    ["https://amazon.co.jp/dp/B0HJBHHXK2", "https://www.amazon.co.jp/dp/B0HJBHHXK2"],
    // /dp/ が無い Amazon の URL は触らない
    ["https://www.amazon.co.jp/gp/bestsellers/?tag=x", "https://www.amazon.co.jp/gp/bestsellers/?tag=x"],
    // 他の店は触らない（tag が付いていても）
    ["https://item.rakuten.co.jp/shop/item/?tag=x&th=1", "https://item.rakuten.co.jp/shop/item/?tag=x&th=1"],
    ["https://www.amazon.com/dp/B0HJBHHXK2?tag=x", "https://www.amazon.com/dp/B0HJBHHXK2?tag=x"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeWantUrl(input)).toBe(expected);
  });

  it("create で保存される URL も正規化されている", async () => {
    const { owner } = await createPair();
    stubPreviewFetch({});
    const created = await call(
      router.want.create,
      { title: "iPhone", url: "https://www.amazon.co.jp/dp/B0HJBHHXK2/?tag=abc-22&th=1" },
      { context: contextFor(owner) },
    );
    expect(created.url).toBe("https://www.amazon.co.jp/dp/B0HJBHHXK2");
  });
});

describe("Want.url の出力検査（T11 のサーバ側）", () => {
  it("DB に javascript: の URL が入っていても list は返さず落ちる（出力スキーマ）", async () => {
    const { owner, coupleId } = await createPair();
    await db
      .prepare("INSERT INTO wants (id, couple_id, owner_id, title, url, note, created_at) VALUES (?1, ?2, ?3, 'x', 'javascript:alert(1)', '', ?4)")
      .bind(crypto.randomUUID(), coupleId, owner.id, Math.floor(Date.now() / 1000))
      .run();
    await expect(call(router.want.list, { ownerSide: "me" }, { context: contextFor(owner) })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

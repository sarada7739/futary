import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 042: 選んだ写真をまとめて共有シートへ（sharePhotos）。T3・T4・T5 のロジック側。
// 画面側（ボタン・通知・選択が残ること）は album-detail-share.test.tsx
const { downloadUrlMock } = vi.hoisted(() => ({ downloadUrlMock: vi.fn() }));
vi.mock("../lib/orpc", () => ({ client: { photo: { downloadUrl: downloadUrlMock } } }));

const { sharePhotos, MAX_SHARE_FILES } = await import("../lib/photo-download");

type Ref = { kind: "album"; photoId: string } | { kind: "post"; postId: string; position: number };
// アルバムの写真と投稿の写真が混ざっていても同じ経路（タイムラインは投稿の写真だけ）
const REFS: Ref[] = [
  { kind: "album", photoId: "01ARZ3NDEKTSV4RRFFQ69G5FA1" },
  { kind: "post", postId: "01ARZ3NDEKTSV4RRFFQ69G5FA2", position: 0 },
  { kind: "album", photoId: "01ARZ3NDEKTSV4RRFFQ69G5FA3" },
];
function idOf(ref: Ref): string {
  return ref.kind === "album" ? ref.photoId : `${ref.postId}-${ref.position}`;
}
function urlOf(ref: Ref): string {
  return `https://r2.example.com/${idOf(ref)}?response-content-disposition=attachment`;
}
// filename の規則はサーバ（photo.downloadUrl）が決める。ここでは返ってきた値がそのまま File の名前になることを見る
function filenameOf(ref: Ref): string {
  return `nisoine-20260816-${idOf(ref)}.jpg`;
}

type NavShare = { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };
const nav = navigator as Navigator & NavShare;
let shareMock: ReturnType<typeof vi.fn<(d: ShareData) => Promise<void>>>;

beforeEach(() => {
  downloadUrlMock.mockReset();
  downloadUrlMock.mockImplementation(async (ref: Ref) => ({ url: urlOf(ref), filename: filenameOf(ref) }));
  // 中身の長さを URL ごとに変えて、File の順序が refs の順と一致することを size で見る
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const index = REFS.findIndex((ref) => url === urlOf(ref));
      return new Response(new Uint8Array(index + 1), { status: 200 });
    }),
  );
  shareMock = vi.fn(async () => {});
  nav.canShare = () => true;
  nav.share = shareMock;
});

afterEach(() => {
  vi.unstubAllGlobals();
  const bag = nav as unknown as Record<string, unknown>;
  Reflect.deleteProperty(bag, "canShare");
  Reflect.deleteProperty(bag, "share");
});

describe("sharePhotos（042）", () => {
  it("1 回の共有は 20 枚まで（1節。段階0で安定すれば 50）", () => {
    expect(MAX_SHARE_FILES).toBe(20);
  });

  it("T3: refs の順に photo.downloadUrl → fetch し、File の数・名前・型が一致する形で share を 1 回呼ぶ。進捗は 0/3 → 3/3", async () => {
    const progress: { done: number; total: number }[] = [];

    const result = await sharePhotos(REFS, (p) => progress.push(p));

    expect(result).toEqual({ outcome: "shared", failed: 0 });
    expect(downloadUrlMock.mock.calls.map((c) => c[0])).toEqual(REFS);
    expect(vi.mocked(fetch).mock.calls.map((c) => c[0])).toEqual(REFS.map(urlOf));
    expect(shareMock).toHaveBeenCalledTimes(1);
    const files = shareMock.mock.calls[0]![0].files!;
    expect(files.map((f) => f.name)).toEqual(REFS.map(filenameOf));
    expect(files.map((f) => f.type)).toEqual(["image/jpeg", "image/jpeg", "image/jpeg"]);
    expect(files.map((f) => f.size)).toEqual([1, 2, 3]);
    expect(progress).toEqual([
      { done: 0, total: 3 },
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it("T4: 1 枚の fetch が失敗（404）してもその枚を飛ばし、残り 2 枚で share を呼ぶ。failed は 1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url === urlOf(REFS[1]!) ? new Response("", { status: 404 }) : new Response(new Uint8Array(3), { status: 200 }))),
    );

    const result = await sharePhotos(REFS);

    expect(result).toEqual({ outcome: "shared", failed: 1 });
    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(shareMock.mock.calls[0]![0].files!.map((f) => f.name)).toEqual([filenameOf(REFS[0]!), filenameOf(REFS[2]!)]);
  });

  it("T4: photo.downloadUrl が失敗した枚も同じく飛ばす（fetch はしない）。進捗は失敗も数える", async () => {
    downloadUrlMock.mockImplementation(async (ref: Ref) => {
      if (ref === REFS[0]) throw new Error("network");
      return { url: urlOf(ref), filename: filenameOf(ref) };
    });
    const progress: { done: number; total: number }[] = [];

    const result = await sharePhotos(REFS, (p) => progress.push(p));

    expect(result).toEqual({ outcome: "shared", failed: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(shareMock.mock.calls[0]![0].files!.map((f) => f.name)).toEqual([filenameOf(REFS[1]!), filenameOf(REFS[2]!)]);
    expect(progress.map((p) => p.done)).toEqual([0, 1, 2, 3]);
  });

  it("1 枚も取得できなければ share を呼ばず outcome は nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));

    const result = await sharePhotos(REFS);

    expect(result).toEqual({ outcome: "nothing", failed: 3 });
    expect(shareMock).not.toHaveBeenCalled();
  });

  it("T5: 共有シートを閉じた（AbortError）ときは aborted を返し、例外を出さない", async () => {
    shareMock.mockImplementation(async () => {
      throw new DOMException("closed", "AbortError");
    });

    await expect(sharePhotos(REFS)).resolves.toEqual({ outcome: "aborted", failed: 0 });
  });

  it("share が AbortError 以外（NotAllowedError 等）で失敗したら例外のまま投げる（画面が「保存できませんでした」を出す）", async () => {
    shareMock.mockImplementation(async () => {
      throw new DOMException("not allowed", "NotAllowedError");
    });

    await expect(sharePhotos(REFS)).rejects.toMatchObject({ name: "NotAllowedError" });
  });

  it("21 枚以上は photo.downloadUrl も share も呼ばず例外（保険。画面は「保存」を無効にして守る）", async () => {
    const many = Array.from({ length: MAX_SHARE_FILES + 1 }, (_, i) => ({ kind: "album" as const, photoId: `photo-${i}` }));

    await expect(sharePhotos(many)).rejects.toThrow("一度に保存できるのは 20 枚までです");
    expect(downloadUrlMock).not.toHaveBeenCalled();
    expect(shareMock).not.toHaveBeenCalled();
  });

  it("refs が空なら share を呼ばず nothing（画面は 0 枚では押せないので保険）", async () => {
    const result = await sharePhotos([]);
    expect(result).toEqual({ outcome: "nothing", failed: 0 });
    expect(shareMock).not.toHaveBeenCalled();
    expect(downloadUrlMock).not.toHaveBeenCalled();
  });
});

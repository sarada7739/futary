import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 048 段階1: ZIP で持ち出す（Z1〜Z5 のロジック側）。ZIP は unzipSync で開いて中身を見る。
// 画面側（⋯ → シート → 保存 → 進捗 → 完了）は zip-export-sheet.test.tsx
const { downloadUrlMock, photoListMock, albumListMock } = vi.hoisted(() => ({
  downloadUrlMock: vi.fn(),
  photoListMock: vi.fn(),
  albumListMock: vi.fn(),
}));
vi.mock("../lib/orpc", () => ({
  client: { photo: { downloadUrl: downloadUrlMock, list: photoListMock }, album: { list: albumListMock } },
}));

const {
  CAPTIONS_FILENAME,
  captionsText,
  collectZipPhotos,
  exportZip,
  safeZipName,
  saveZipFile,
  zipConfirmLabel,
  zipFileName,
  zipPartCount,
  ZIP_PART_SIZE,
} = await import("../lib/album-zip");

type Ref = { kind: "album"; photoId: string } | { kind: "post"; postId: string; position: number };
type Entry = { ref: Ref; caption: string; folder: string | null };

function albumRef(i: number): Ref {
  return { kind: "album", photoId: `photo-${i}` };
}
function idOf(ref: Ref): string {
  return ref.kind === "album" ? ref.photoId : `${ref.postId}-${ref.position}`;
}
function urlOf(ref: Ref): string {
  return `https://r2.example.com/${idOf(ref)}?response-content-disposition=attachment`;
}
// filename の規則はサーバ（photo.downloadUrl）が決める。返ってきた値がそのまま ZIP の中の名前になることを見る
function filenameOf(ref: Ref): string {
  return `nisoine-20260816-${idOf(ref)}.jpg`;
}
function entries(count: number, folder: string | null = null): Entry[] {
  return Array.from({ length: count }, (_, i) => ({ ref: albumRef(i + 1), caption: i % 2 === 0 ? `説明 ${i + 1}` : "", folder }));
}
// 中身は写真ごとに長さを変える（順序と対応を size で見る）。同じバイトの繰り返し（4KB + n）なので
// 圧縮すれば数十バイトに縮む。Z1 の「無圧縮」はこれで見る（R の段階1レビュー記録 1: 1〜3 バイトでは縮まず緑のままだった）
const COMPRESSIBLE_BYTES = 4096;
function bytesOf(ref: Ref): Uint8Array<ArrayBuffer> {
  const n = Number(idOf(ref).replace(/\D/g, "")) || 1;
  return new Uint8Array(COMPRESSIBLE_BYTES + n).fill(0xff);
}

// 2026-09-14 12:00 JST
const NOW_MS = Date.UTC(2026, 8, 14, 3, 0, 0);
let saved: { bytes: Uint8Array; filename: string }[];
const save = (bytes: Uint8Array, filename: string) => {
  saved.push({ bytes, filename });
};
function unzip(index = 0): Record<string, Uint8Array> {
  return unzipSync(saved[index]!.bytes);
}

beforeEach(() => {
  saved = [];
  downloadUrlMock.mockReset();
  photoListMock.mockReset();
  albumListMock.mockReset();
  downloadUrlMock.mockImplementation(async (ref: Ref) => ({ url: urlOf(ref), filename: filenameOf(ref) }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      const id = new URL(url).pathname.slice(1);
      return new Response(bytesOf({ kind: "album", photoId: id }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saveZipFile", () => {
  it("Blob URL を作って <a download> を押し、少し置いてから URL を捨てる（jsdom に createObjectURL は無いので生やす）", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:nisoine/zip-1");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clicked: string[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "a") {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          clicked.push(`${(el as HTMLAnchorElement).download}|${(el as HTMLAnchorElement).href}`);
        });
      }
      return el;
    });

    saveZipFile(new Uint8Array([0x50, 0x4b]), "nisoine-albums-20260914.zip");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect((createObjectURL.mock.calls[0] as unknown[])[0]).toBeInstanceOf(Blob);
    expect(clicked).toEqual(["nisoine-albums-20260914.zip|blob:nisoine/zip-1"]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:nisoine/zip-1");
    vi.useRealTimers();
  });
});

describe("名前（タスク定義 2節）", () => {
  it("ZIP・フォルダの名前に使えない文字を _ にする。空なら album", () => {
    expect(safeZipName('京都/旅行:2026*夏?"<秋>|\\冬')).toBe("京都_旅行_2026_夏___秋___冬");
    expect(safeZipName("  ")).toBe("album");
    expect(safeZipName("京都旅行")).toBe("京都旅行");
  });

  it("Z1b: `.` だけの名前は album に倒す。TAB・改行・制御文字も _ に（R の段階1レビュー記録 2）", () => {
    expect(safeZipName("..")).toBe("album");
    expect(safeZipName(".")).toBe("album");
    expect(safeZipName("  ..  ")).toBe("album");
    expect(safeZipName("...")).toBe("album");
    expect(safeZipName("..a")).toBe("..a");
    expect(safeZipName("京都\t旅行\n2026\u0000")).toBe("京都_旅行_2026_");
  });

  it("Z1b: 説明文の TAB も空白にする（captions.txt の区切りを壊さない）", () => {
    expect(captionsText([{ name: "a.jpg", caption: "海\tの日" }])).toBe("a.jpg\t海 の日\n");
  });

  it("nisoine-{名前}-{YYYYMMDD}.zip。分けるときは -1of3", () => {
    expect(zipFileName("京都旅行", "20260914", null)).toBe("nisoine-京都旅行-20260914.zip");
    expect(zipFileName("albums", "20260914", { index: 2, total: 3 })).toBe("nisoine-albums-20260914-2of3.zip");
  });

  it("1 つの ZIP は 100 枚まで。101 枚は 2 つ", () => {
    expect(ZIP_PART_SIZE).toBe(100);
    expect(zipPartCount(100)).toBe(1);
    expect(zipPartCount(101)).toBe(2);
    expect(zipPartCount(0)).toBe(0);
  });

  it("確認の文言は枚数 × 400KB の概算。1MB 未満は約 1MB", () => {
    expect(zipConfirmLabel(38)).toBe("38 枚を ZIP で保存します（約 15MB）");
    expect(zipConfirmLabel(1)).toBe("1 枚を ZIP で保存します（約 1MB）");
  });

  it("captions.txt は 1 行 1 枚（パス TAB 説明文）。説明文の改行は空白にする", () => {
    expect(captionsText([{ name: "a.jpg", caption: "海\nの日" }, { name: "b/c.jpg", caption: "" }])).toBe("a.jpg\t海 の日\nb/c.jpg\t\n");
  });
});

describe("collectZipPhotos", () => {
  it("1 つのアルバム: photo.list を limit 60 で最後まで辿り、表示順に集める", async () => {
    photoListMock
      .mockResolvedValueOnce({ items: [{ ref: albumRef(1), caption: "一" }, { ref: albumRef(2), caption: "" }], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [{ ref: albumRef(3), caption: "三" }], nextCursor: null });

    const photos = await collectZipPhotos({ kind: "album", albumId: "album-1", title: "京都旅行" });

    expect(photos).toEqual([
      { ref: albumRef(1), caption: "一", folder: null },
      { ref: albumRef(2), caption: "", folder: null },
      { ref: albumRef(3), caption: "三", folder: null },
    ]);
    expect(photoListMock.mock.calls.map((c) => c[0])).toEqual([
      { albumId: "album-1", cursor: undefined, limit: 60 },
      { albumId: "album-1", cursor: "c1", limit: 60 },
    ]);
  });

  it("Z5: 全部は album.list の items だけを辿る。タイムライン（albumId 無しの photo.list）は呼ばない。アルバムごとのフォルダに分ける", async () => {
    albumListMock.mockResolvedValue({
      timeline: { photoCount: 5, previews: [] },
      items: [
        { id: "album-1", title: "京都/旅行", photoCount: 2 },
        { id: "album-2", title: "空", photoCount: 0 },
        { id: "album-3", title: "沖縄", photoCount: 1 },
      ],
    });
    photoListMock.mockImplementation(async ({ albumId }: { albumId?: string }) => {
      if (albumId === "album-1") return { items: [{ ref: albumRef(1), caption: "" }, { ref: albumRef(2), caption: "" }], nextCursor: null };
      if (albumId === "album-3") return { items: [{ ref: albumRef(3), caption: "" }], nextCursor: null };
      throw new Error(`想定外の photo.list: ${String(albumId)}`);
    });

    const photos = await collectZipPhotos({ kind: "all" });

    expect(photos.map((p) => [idOf(p.ref), p.folder])).toEqual([
      ["photo-1", "京都_旅行"],
      ["photo-2", "京都_旅行"],
      ["photo-3", "沖縄"],
    ]);
    // albumId の無い呼び出し（タイムライン）が 1 つも無い。0 枚のアルバムは呼ばない
    expect(photoListMock.mock.calls.map((c) => c[0].albumId)).toEqual(["album-1", "album-3"]);
  });
});

describe("exportZip", () => {
  it("Z1: 枚数・ファイル名・中身が揃い、captions.txt が 1 行 1 枚で対応する。無圧縮。名前は nisoine-{名前}-{YYYYMMDD}.zip", async () => {
    const photos = entries(3);
    const progress: { done: number; total: number }[] = [];

    const result = await exportZip(photos, "京都旅行", { signal: new AbortController().signal, onProgress: (p) => progress.push(p), save, nowMs: NOW_MS });

    expect(result).toEqual({ outcome: "saved", failed: 0, parts: 1 });
    expect(saved.map((s) => s.filename)).toEqual(["nisoine-京都旅行-20260914.zip"]);
    const files = unzip();
    expect(Object.keys(files)).toEqual([filenameOf(albumRef(1)), filenameOf(albumRef(2)), filenameOf(albumRef(3)), CAPTIONS_FILENAME]);
    for (const photo of photos) expect(files[filenameOf(photo.ref)]).toEqual(bytesOf(photo.ref));
    expect(strFromU8(files[CAPTIONS_FILENAME]!)).toBe(
      `${filenameOf(albumRef(1))}\t説明 1\n${filenameOf(albumRef(2))}\t\n${filenameOf(albumRef(3))}\t説明 3\n`,
    );
    // ZIP は無圧縮（縮む中身でも、中身の合計より小さくならない。level: 0 を外すと 12KB が数十バイトになって赤）
    const payload = photos.reduce((sum, p) => sum + bytesOf(p.ref).byteLength, 0);
    expect(payload).toBeGreaterThan(3 * COMPRESSIBLE_BYTES);
    expect(saved[0]!.bytes.byteLength).toBeGreaterThanOrEqual(payload);
    expect(downloadUrlMock.mock.calls.map((c) => c[0])).toEqual(photos.map((p) => p.ref));
    expect(progress).toEqual([
      { done: 0, total: 3 },
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it("Z1b: 題が `..`・TAB 入りのアルバムでも ZIP 内のパスに ../ が無く、captions.txt の区切りが壊れない", async () => {
    albumListMock.mockResolvedValue({
      timeline: { photoCount: 0, previews: [] },
      items: [
        { id: "album-1", title: "..", photoCount: 1 },
        { id: "album-2", title: "海\tの日", photoCount: 1 },
      ],
    });
    photoListMock.mockImplementation(async ({ albumId }: { albumId?: string }) => ({
      items: [{ ref: albumRef(albumId === "album-1" ? 1 : 2), caption: albumId === "album-1" ? "a\tb" : "" }],
      nextCursor: null,
    }));
    const photos = await collectZipPhotos({ kind: "all" });

    await exportZip(photos, "albums", { signal: new AbortController().signal, save, nowMs: NOW_MS });

    const files = unzip();
    const names = Object.keys(files);
    expect(names).toEqual([`album/${filenameOf(albumRef(1))}`, `海_の日/${filenameOf(albumRef(2))}`, CAPTIONS_FILENAME]);
    expect(names.some((n) => n.includes(".."))).toBe(false);
    // 各行は TAB が 1 つだけ（パスに TAB が無く、説明文の TAB も空白になっている）
    const lines = strFromU8(files[CAPTIONS_FILENAME]!).split("\n").filter(Boolean);
    expect(lines.map((l) => l.split("\t").length)).toEqual([2, 2]);
    expect(lines[0]).toBe(`album/${filenameOf(albumRef(1))}\ta b`);
  });

  it("全部のときはアルバムごとのフォルダの下に入り、captions.txt もそのパスで書く", async () => {
    const photos: Entry[] = [
      { ref: albumRef(1), caption: "京", folder: "京都旅行" },
      { ref: albumRef(2), caption: "", folder: "沖縄" },
    ];

    await exportZip(photos, "albums", { signal: new AbortController().signal, save, nowMs: NOW_MS });

    const files = unzip();
    expect(Object.keys(files)).toEqual([`京都旅行/${filenameOf(albumRef(1))}`, `沖縄/${filenameOf(albumRef(2))}`, CAPTIONS_FILENAME]);
    expect(strFromU8(files[CAPTIONS_FILENAME]!)).toBe(`京都旅行/${filenameOf(albumRef(1))}\t京\n沖縄/${filenameOf(albumRef(2))}\t\n`);
  });

  it("Z2: 101 枚 → 2 つ（100 + 1）。-1of2 と -2of2。進捗は全体で数える", async () => {
    const photos = entries(101);
    const progress: number[] = [];

    const result = await exportZip(photos, "albums", { signal: new AbortController().signal, onProgress: (p) => progress.push(p.done), save, nowMs: NOW_MS });

    expect(result).toEqual({ outcome: "saved", failed: 0, parts: 2 });
    expect(saved.map((s) => s.filename)).toEqual(["nisoine-albums-20260914-1of2.zip", "nisoine-albums-20260914-2of2.zip"]);
    const first = unzip(0);
    const second = unzip(1);
    expect(Object.keys(first)).toHaveLength(100 + 1);
    expect(Object.keys(second)).toEqual([filenameOf(albumRef(101)), CAPTIONS_FILENAME]);
    expect(strFromU8(first[CAPTIONS_FILENAME]!).split("\n").filter(Boolean)).toHaveLength(100);
    expect(strFromU8(second[CAPTIONS_FILENAME]!).split("\n").filter(Boolean)).toHaveLength(1);
    expect(progress.at(-1)).toBe(101);
    expect(progress).toHaveLength(102);
  });

  it("Z3: 1 枚の fetch が失敗（404）しても残りが入り、failed は 1。captions.txt にもその枚は無い", async () => {
    const photos = entries(3);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url === urlOf(albumRef(2)) ? new Response("", { status: 404 }) : new Response(bytesOf(albumRef(1)), { status: 200 }))),
    );

    const result = await exportZip(photos, "京都旅行", { signal: new AbortController().signal, save, nowMs: NOW_MS });

    expect(result).toEqual({ outcome: "saved", failed: 1, parts: 1 });
    const files = unzip();
    expect(Object.keys(files)).toEqual([filenameOf(albumRef(1)), filenameOf(albumRef(3)), CAPTIONS_FILENAME]);
    expect(strFromU8(files[CAPTIONS_FILENAME]!).split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("Z3: photo.downloadUrl が失敗した枚も同じく飛ばす（fetch はしない）", async () => {
    downloadUrlMock.mockImplementation(async (ref: Ref) => {
      if (idOf(ref) === "photo-1") throw new Error("network");
      return { url: urlOf(ref), filename: filenameOf(ref) };
    });

    const result = await exportZip(entries(3), "京都旅行", { signal: new AbortController().signal, save, nowMs: NOW_MS });

    expect(result).toEqual({ outcome: "saved", failed: 1, parts: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Object.keys(unzip())).toEqual([filenameOf(albumRef(2)), filenameOf(albumRef(3)), CAPTIONS_FILENAME]);
  });

  it("1 枚も取得できなければ ZIP を作らず nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));

    const result = await exportZip(entries(3), "京都旅行", { signal: new AbortController().signal, save, nowMs: NOW_MS });

    expect(result).toEqual({ outcome: "nothing", failed: 3, parts: 0 });
    expect(saved).toEqual([]);
  });

  it("Z4: 途中で閉じる（abort）と fetch に signal が渡っていて中断され、残りは取りに行かず aborted。ZIP は作らない", async () => {
    const controller = new AbortController();
    // 2 枚目の fetch の途中で閉じる
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === urlOf(albumRef(2))) {
          controller.abort();
          // 本物の fetch は signal が abort されると AbortError で拒否する
          expect(init?.signal).toBe(controller.signal);
          throw new DOMException("aborted", "AbortError");
        }
        return new Response(bytesOf(albumRef(1)), { status: 200 });
      }),
    );

    const result = await exportZip(entries(5), "京都旅行", { signal: controller.signal, save, nowMs: NOW_MS });

    expect(result).toEqual({ outcome: "aborted", failed: 0, parts: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(downloadUrlMock).toHaveBeenCalledTimes(2);
    expect(saved).toEqual([]);
  });

  it("Z4: 2 つ目の ZIP の途中で閉じたら、1 つ目は保存済みのまま aborted（parts は 1）", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === urlOf(albumRef(101))) {
          controller.abort();
          throw new DOMException("aborted", "AbortError");
        }
        return new Response(bytesOf(albumRef(1)), { status: 200 });
      }),
    );

    const result = await exportZip(entries(102), "albums", { signal: controller.signal, save, nowMs: NOW_MS });

    expect(result).toEqual({ outcome: "aborted", failed: 0, parts: 1 });
    expect(saved.map((s) => s.filename)).toEqual(["nisoine-albums-20260914-1of2.zip"]);
  });

  it("写真が 0 枚なら何も呼ばず nothing", async () => {
    const result = await exportZip([], "albums", { signal: new AbortController().signal, save, nowMs: NOW_MS });
    expect(result).toEqual({ outcome: "nothing", failed: 0, parts: 0 });
    expect(downloadUrlMock).not.toHaveBeenCalled();
  });
});

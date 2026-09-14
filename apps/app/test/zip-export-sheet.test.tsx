import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 048 段階1: 「ZIP で保存」のシートの画面側。開く → 数える → 確認（枚数・概算・分ける数）→ 保存 → 進捗 → 完了。
// 途中で「やめる」→ fetch が中断される（Z4 の画面側）。ZIP の中身は album-zip.test.ts
const { downloadUrlMock, photoListMock, albumListMock } = vi.hoisted(() => ({
  downloadUrlMock: vi.fn(),
  photoListMock: vi.fn(),
  albumListMock: vi.fn(),
}));
vi.mock("../lib/orpc", () => ({
  client: { photo: { downloadUrl: downloadUrlMock, list: photoListMock }, album: { list: albumListMock } },
}));

const { ZipExportSheet } = await import("../components/zip-export-sheet");

function photo(i: number) {
  return { ref: { kind: "album", photoId: `photo-${i}` }, caption: i === 1 ? "一" : "" };
}
// photo.list を limit 60 で辿る形にする（count 枚を 60 ずつのページで返す）
function listPages(count: number) {
  photoListMock.mockImplementation(async ({ cursor }: { cursor?: string }) => {
    const start = cursor ? Number(cursor) : 0;
    const end = Math.min(start + 60, count);
    return { items: Array.from({ length: end - start }, (_, i) => photo(start + i + 1)), nextCursor: end < count ? String(end) : null };
  });
}

let createObjectURL: ReturnType<typeof vi.fn>;
let clicked: string[];

beforeEach(() => {
  vi.clearAllMocks();
  downloadUrlMock.mockImplementation(async (ref: { photoId: string }) => ({
    url: `https://r2.example.com/${ref.photoId}`,
    filename: `nisoine-20260816-${ref.photoId}.jpg`,
  }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 })));
  // jsdom に createObjectURL は無い。<a download> のクリックは記録だけ（遷移しない）
  createObjectURL = vi.fn(() => "blob:nisoine/zip");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
  clicked = [];
  const originalCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = originalCreate(tag);
    if (tag === "a") {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        clicked.push((el as HTMLAnchorElement).download);
      });
    }
    return el;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ALBUM = { kind: "album" as const, albumId: "album-1", title: "京都旅行" };

describe("ZipExportSheet", () => {
  it("閉じている（source null）ときは何も出さず、photo.list も呼ばない", () => {
    render(<ZipExportSheet source={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId("zip-export-sheet")).toBeNull();
    expect(photoListMock).not.toHaveBeenCalled();
  });

  it("開くと数えてから「38 枚を ZIP で保存します（約 15MB）」。100 枚以下なので分ける行は無い。キャンセルで onClose", async () => {
    listPages(38);
    const onClose = vi.fn();
    render(<ZipExportSheet source={ALBUM} onClose={onClose} />);

    expect(await screen.findByTestId("zip-export-confirm")).toHaveTextContent("38 枚を ZIP で保存します（約 15MB）");
    expect(screen.queryByTestId("zip-export-parts")).toBeNull();
    fireEvent.click(screen.getByText("キャンセル"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(downloadUrlMock).not.toHaveBeenCalled();
  });

  it("101 枚なら「2 つのファイルに分けて保存します」を先に出す", async () => {
    listPages(101);
    render(<ZipExportSheet source={ALBUM} onClose={vi.fn()} />);

    expect(await screen.findByTestId("zip-export-confirm")).toHaveTextContent("101 枚を ZIP で保存します（約 39MB）");
    expect(screen.getByTestId("zip-export-parts")).toHaveTextContent("2 つのファイルに分けて保存します");
  });

  it("写真が 0 枚なら「保存する写真がありません」と閉じるだけ", async () => {
    listPages(0);
    render(<ZipExportSheet source={ALBUM} onClose={vi.fn()} />);

    expect(await screen.findByTestId("zip-export-empty")).toBeTruthy();
    expect(screen.queryByTestId("zip-export-start")).toBeNull();
    expect(screen.getByTestId("zip-export-close")).toBeTruthy();
  });

  it("「保存」→ 進捗「N / 3 枚を取得中…」→ ZIP を 1 つ保存して「保存しました」。名前は nisoine-京都旅行-{今日}.zip", async () => {
    listPages(3);
    render(<ZipExportSheet source={ALBUM} onClose={vi.fn()} />);
    await screen.findByTestId("zip-export-confirm");

    await act(async () => {
      fireEvent.click(screen.getByTestId("zip-export-start"));
    });

    expect(await screen.findByTestId("zip-export-done")).toHaveTextContent("保存しました");
    expect(screen.queryByTestId("zip-export-failed")).toBeNull();
    expect(downloadUrlMock).toHaveBeenCalledTimes(3);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toMatch(/^nisoine-京都旅行-\d{8}\.zip$/);
  });

  it("全部（all）は album.list のアルバムを辿り、名前は nisoine-albums-{今日}.zip。題は「すべての写真を ZIP で保存」", async () => {
    albumListMock.mockResolvedValue({
      timeline: { photoCount: 9, previews: [] },
      items: [{ id: "album-1", title: "京都旅行", photoCount: 2 }],
    });
    listPages(2);
    render(<ZipExportSheet source={{ kind: "all" }} onClose={vi.fn()} />);
    expect(await screen.findByText("すべての写真を ZIP で保存")).toBeTruthy();
    expect(await screen.findByTestId("zip-export-confirm")).toHaveTextContent("2 枚を ZIP で保存します");

    await act(async () => {
      fireEvent.click(screen.getByTestId("zip-export-start"));
    });

    await screen.findByTestId("zip-export-done");
    expect(clicked[0]).toMatch(/^nisoine-albums-\d{8}\.zip$/);
    // タイムライン（albumId 無し）は呼んでいない
    expect(photoListMock.mock.calls.every((c) => c[0].albumId === "album-1")).toBe(true);
  });

  it("取れなかった枚があれば「保存しました」の下に「1 枚は保存できませんでした」", async () => {
    listPages(3);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.endsWith("photo-2") ? new Response("", { status: 404 }) : new Response(new Uint8Array(3), { status: 200 }))),
    );
    render(<ZipExportSheet source={ALBUM} onClose={vi.fn()} />);
    await screen.findByTestId("zip-export-confirm");

    await act(async () => {
      fireEvent.click(screen.getByTestId("zip-export-start"));
    });

    expect(await screen.findByTestId("zip-export-done")).toHaveTextContent("保存しました");
    expect(screen.getByTestId("zip-export-failed")).toHaveTextContent("1 枚は保存できませんでした");
  });

  it("1 枚も取れなければ「保存できませんでした。もう一度お試しください」で ZIP は作らない", async () => {
    listPages(2);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    render(<ZipExportSheet source={ALBUM} onClose={vi.fn()} />);
    await screen.findByTestId("zip-export-confirm");

    await act(async () => {
      fireEvent.click(screen.getByTestId("zip-export-start"));
    });

    expect(await screen.findByTestId("zip-export-done")).toHaveTextContent("保存できませんでした。もう一度お試しください");
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("Z4: 取得中に「やめる」→ fetch に渡した signal が abort され、残りは取りに行かず、onClose が呼ばれる。ZIP は作らない", async () => {
    listPages(5);
    // 1 枚目の fetch を止めておく（やめるまで解決しない）
    let release: (() => void) | null = null;
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const signal = init!.signal!;
            signals.push(signal);
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            release = () => resolve(new Response(new Uint8Array(3), { status: 200 }));
          }),
      ),
    );
    const onClose = vi.fn();
    render(<ZipExportSheet source={ALBUM} onClose={onClose} />);
    await screen.findByTestId("zip-export-confirm");

    await act(async () => {
      fireEvent.click(screen.getByTestId("zip-export-start"));
    });
    expect(await screen.findByTestId("zip-export-progress")).toHaveTextContent("0 / 5 枚を取得中…");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.click(screen.getByTestId("zip-export-abort"));
    });

    expect(signals[0]!.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    // 止まったあと 2 枚目以降を取りに行かない
    await act(async () => {
      release?.();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(downloadUrlMock).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("取得中にシートを閉じる（背景を押す）のも中断になる", async () => {
    listPages(3);
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signals.push(init!.signal!);
            init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const onClose = vi.fn();
    render(<ZipExportSheet source={ALBUM} onClose={onClose} />);
    await screen.findByTestId("zip-export-confirm");
    await act(async () => {
      fireEvent.click(screen.getByTestId("zip-export-start"));
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.click(screen.getByLabelText("閉じる"));
    });

    expect(signals[0]!.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("数えるのに失敗したら「保存できませんでした。もう一度お試しください」", async () => {
    photoListMock.mockRejectedValue(new Error("network"));
    render(<ZipExportSheet source={ALBUM} onClose={vi.fn()} />);
    expect(await screen.findByTestId("zip-export-error")).toBeTruthy();
  });
});

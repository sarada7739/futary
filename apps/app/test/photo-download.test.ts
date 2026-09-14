import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 041 段階2（8節）: 保存の経路。canShare が真なら共有シート（fetch → File → navigator.share）、
// 偽なら <a download>。AbortError は何もしない。他の失敗は <a download> に倒す
const { downloadUrlMock } = vi.hoisted(() => ({ downloadUrlMock: vi.fn() }));
vi.mock("../lib/orpc", () => ({ client: { photo: { downloadUrl: downloadUrlMock } } }));

const { downloadPhoto, canShareFiles } = await import("../lib/photo-download");

const REF = { kind: "album" as const, photoId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" };
const URL_ = "https://r2.example.com/x?response-content-disposition=attachment";
const FILENAME = "nisoine-20260816-01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg";

type NavShare = { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };
const nav = navigator as Navigator & NavShare;
// jsdom の navigator に canShare / share は無い。テストごとに生やして、終わったら消す
function resetShareApi() {
  const bag = nav as unknown as Record<string, unknown>;
  Reflect.deleteProperty(bag, "canShare");
  Reflect.deleteProperty(bag, "share");
}

// <a download> のクリックを記録する（実際の遷移はしない）
function watchAnchors(): string[] {
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
  return clicked;
}

beforeEach(() => {
  downloadUrlMock.mockReset();
  downloadUrlMock.mockResolvedValue({ url: URL_, filename: FILENAME });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetShareApi();
});

describe("downloadPhoto（041 段階2）", () => {
  it("canShare が偽（PC）なら <a download> を押し、fetch も share もしない", async () => {
    const clicked = watchAnchors();
    nav.canShare = () => false;
    nav.share = vi.fn();

    await downloadPhoto(REF);

    expect(clicked).toEqual([`${FILENAME}|${URL_}`]);
    expect(fetch).not.toHaveBeenCalled();
    expect(nav.share).not.toHaveBeenCalled();
  });

  it("canShare が無い環境（jsdom の既定）も <a download>", async () => {
    const clicked = watchAnchors();
    expect(canShareFiles()).toBe(false);
    await downloadPhoto(REF);
    expect(clicked).toHaveLength(1);
  });

  it("canShare が真なら署名付き URL を fetch して File 1 つで share を呼び、<a> は作らない", async () => {
    const clicked = watchAnchors();
    nav.canShare = () => true;
    const share = vi.fn<(d: ShareData) => Promise<void>>(async () => {});
    nav.share = share;

    await downloadPhoto(REF);

    expect(fetch).toHaveBeenCalledWith(URL_);
    expect(share).toHaveBeenCalledTimes(1);
    const data = share.mock.calls[0]![0];
    expect(data.files).toHaveLength(1);
    const file = data.files![0]!;
    expect(file.name).toBe(FILENAME);
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(3);
    expect(clicked).toEqual([]);
  });

  it("共有シートを閉じた（AbortError）ときは何もしない（<a download> にも倒さない・例外も出さない）", async () => {
    const clicked = watchAnchors();
    nav.canShare = () => true;
    nav.share = vi.fn(async () => {
      throw new DOMException("closed", "AbortError");
    });

    await expect(downloadPhoto(REF)).resolves.toBeUndefined();
    expect(clicked).toEqual([]);
  });

  it("share が AbortError 以外（NotAllowedError 等）で失敗したら <a download> に倒す", async () => {
    const clicked = watchAnchors();
    nav.canShare = () => true;
    nav.share = vi.fn(async () => {
      throw new DOMException("not allowed", "NotAllowedError");
    });

    await downloadPhoto(REF);
    expect(clicked).toEqual([`${FILENAME}|${URL_}`]);
  });

  it("fetch が失敗（CORS・404）したら share を呼ばず <a download> に倒す", async () => {
    const clicked = watchAnchors();
    nav.canShare = () => true;
    const share = vi.fn(async () => {});
    nav.share = share;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

    await downloadPhoto(REF);
    expect(share).not.toHaveBeenCalled();
    expect(clicked).toEqual([`${FILENAME}|${URL_}`]);
  });

  it("photo.downloadUrl が失敗したら例外のまま（ビューアが「保存できませんでした」を出す）", async () => {
    downloadUrlMock.mockRejectedValue(new Error("network"));
    await expect(downloadPhoto(REF)).rejects.toThrow("network");
  });
});

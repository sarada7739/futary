import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@futary/contract";
import { PostCard } from "../components/post-card";
import { ImageViewer } from "../components/image-viewer";
import { MAX_SINGLE_IMAGE_HEIGHT, ROW_ITEM_WIDTH_RATIO, singleImageLayout } from "../components/post-images";

// 041: ビューアの保存ボタンは photo.downloadUrl を呼ぶ。画面テストでは差し替える
const { downloadUrlMock } = vi.hoisted(() => ({ downloadUrlMock: vi.fn() }));
vi.mock("../lib/orpc", () => ({ client: { photo: { downloadUrl: downloadUrlMock } } }));

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    authorId: "author-1",
    authorName: "投稿者",
    authorImage: null,
    body: "こんにちは",
    images: [],
    createdAt: Math.floor(Date.now() / 1000),
    reactions: [],
    ...overrides,
  };
}

// M2まとめ監査 Low指摘: 未認証（デモ閲覧）でもリアクションボタンが押せ、
// サーバのFORBIDDENで黙って巻き戻る体験を避けるため、呼び出し側
// （app/(tabs)/index.tsx）は未認証時に onToggleReaction を渡さない。
// PostCard 自身は onToggleReaction が無ければボタンを出さないことをここで担保する
describe("PostCard のリアクションボタン", () => {
  it("onToggleReaction が渡されていれば表示される", () => {
    render(<PostCard post={makePost()} isOwn={false} onToggleReaction={vi.fn()} />);
    expect(screen.getByTestId("post-card-reaction-heart")).toBeTruthy();
  });

  it("onToggleReaction が無ければ表示されない（未認証のデモ閲覧を想定）", () => {
    render(<PostCard post={makePost()} isOwn={false} />);
    expect(screen.queryByTestId("post-card-reaction-heart")).toBeNull();
  });

  it("件数0のときは絵文字のみで件数を表示しない", () => {
    render(<PostCard post={makePost({ reactions: [] })} isOwn={false} onToggleReaction={vi.fn()} />);
    expect(screen.getByTestId("post-card-reaction-heart").textContent).toBe("🤍");
  });

  it("自分が付けている場合は反応済みの絵文字と件数を表示する", () => {
    render(
      <PostCard
        post={makePost({ reactions: [{ kind: "heart", count: 2, reactedByMe: true }] })}
        isOwn={false}
        onToggleReaction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("post-card-reaction-heart").textContent).toBe("❤️ 2");
  });
});

function makePostWithImage(overrides: Partial<Post> = {}): Post {
  return makePost({
    images: [{ url: "https://example.com/image.jpg", width: 800, height: 600 }],
    ...overrides,
  });
}

// 031: 複数枚（1〜4枚を並べたときに使う汎用ヘルパー）
function makeImages(count: number): Post["images"] {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://example.com/image-${i + 1}.jpg`,
    width: 100,
    height: 100,
  }));
}

// 017: 画像タップで全画面表示（ImageViewer）が開閉すること
describe("PostCard の画像タップ（017: 全画面表示）", () => {
  it("画像をタップすると全画面表示が開く", () => {
    render(<PostCard post={makePostWithImage()} isOwn={false} />);
    expect(screen.queryByTestId("image-viewer-backdrop")).toBeNull();

    fireEvent.click(screen.getByLabelText("画像を全画面表示"));

    expect(screen.getByTestId("image-viewer-backdrop")).toBeTruthy();
  });

  it("×ボタンで閉じる", () => {
    render(<PostCard post={makePostWithImage()} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示"));

    fireEvent.click(screen.getByTestId("image-viewer-close"));

    expect(screen.queryByTestId("image-viewer-backdrop")).toBeNull();
  });

  it("画像の外側（バックドロップ）タップで閉じる", () => {
    render(<PostCard post={makePostWithImage()} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示"));

    fireEvent.click(screen.getByTestId("image-viewer-backdrop"));

    expect(screen.queryByTestId("image-viewer-backdrop")).toBeNull();
  });

  // 017: 当初「画像の外側のみ」を閉じる導線にしていたが、containによる
  // レターボックス部分の当たり判定を画像側のPressableが覆ってしまい閉じない
  // 不具合をRのレビューで指摘された。当たり判定という概念自体を無くし
  // 「どこでも閉じる」に変更した（画像タップでバックドロップのonPressへ
  // 自然にバブリングすることを確認する）
  it("画像自体をタップしても閉じる（どこでも閉じる仕様）", () => {
    render(<PostCard post={makePostWithImage()} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示"));

    fireEvent.click(screen.getByTestId("image-viewer-image"));

    expect(screen.queryByTestId("image-viewer-backdrop")).toBeNull();
  });

  it("画像が無い投稿では全画面表示の入口が無い", () => {
    render(<PostCard post={makePost({ images: [] })} isOwn={false} />);
    expect(screen.queryByLabelText("画像を全画面表示")).toBeNull();
  });

  // Web版のEsc（react-native-webのModalが既定でdocumentのkeyupを見て
  // onRequestCloseを呼ぶ。Androidの戻るボタンも同じonRequestCloseで扱われる）
  it("Escキーで閉じる", () => {
    render(<PostCard post={makePostWithImage()} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示"));
    expect(screen.getByTestId("image-viewer-backdrop")).toBeTruthy();

    fireEvent.keyUp(document, { key: "Escape" });

    expect(screen.queryByTestId("image-viewer-backdrop")).toBeNull();
  });
});

// 031: 1投稿に複数画像。グリッド表示・ライトボックスの左右送りを確認する
describe("PostCard の複数画像（031）", () => {
  it("2枚以上では各画像に別々のタップ入口ができる（枚数ぶんの見出し）", () => {
    render(<PostCard post={makePost({ images: makeImages(3) })} isOwn={false} />);
    expect(screen.getByLabelText("画像を全画面表示（1枚目）")).toBeTruthy();
    expect(screen.getByLabelText("画像を全画面表示（2枚目）")).toBeTruthy();
    expect(screen.getByLabelText("画像を全画面表示（3枚目）")).toBeTruthy();
  });

  it("タップした枚数目からライトボックスが開き、枚数が表示される（左右ボタンで送れる）", () => {
    render(<PostCard post={makePost({ images: makeImages(3) })} isOwn={false} />);

    fireEvent.click(screen.getByLabelText("画像を全画面表示（2枚目）"));

    expect(screen.getByTestId("image-viewer-counter").textContent).toBe("2 / 3");

    fireEvent.click(screen.getByTestId("image-viewer-next"));
    expect(screen.getByTestId("image-viewer-counter").textContent).toBe("3 / 3");

    fireEvent.click(screen.getByTestId("image-viewer-prev"));
    fireEvent.click(screen.getByTestId("image-viewer-prev"));
    expect(screen.getByTestId("image-viewer-counter").textContent).toBe("1 / 3");
  });

  it("1枚のときはライトボックスに枚数（カウンター）を出さない（見え方を変えない）", () => {
    render(<PostCard post={makePostWithImage()} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示"));

    expect(screen.queryByTestId("image-viewer-counter")).toBeNull();
    expect(screen.queryByTestId("image-viewer-prev")).toBeNull();
    expect(screen.queryByTestId("image-viewer-next")).toBeNull();
  });
});

// react-native-webのScrollViewは、発火したDOM `scroll` イベントの
// `e.target.scrollLeft`/`e.target.offsetWidth`を直接読む
// （image-viewer.tsxのhandleScrollのコメント参照）。fireEventの第二引数に
// nativeEventを渡しても読まれないため、DOM要素自体のプロパティを
// 差し替えてから素の'scroll'イベントを発火させる。
// react-native-web内部はscrollEventThrottleとscrollイベント終了の検知に
// 実時間のsetTimeoutを使っており、同一ミリ秒内で連続発火させると2件目以降が
// 間引かれる（実測して判明）。フェイクタイマーで100ms以上進め、
// 内部のデバウンス（handleScrollEnd）を確実に発火させる
function simulateSwipeTo(scrollNode: HTMLElement, scrollLeft: number, pageWidth: number) {
  Object.defineProperty(scrollNode, "offsetWidth", { value: pageWidth, configurable: true });
  Object.defineProperty(scrollNode, "scrollLeft", { value: scrollLeft, configurable: true, writable: true });
  fireEvent.scroll(scrollNode);
  act(() => {
    vi.advanceTimersByTime(150);
  });
}

// 033: 複数画像をXのように横一列に並べ、指で送れるようにした
// （031の正方形グリッドを覆した）。ライトボックスもスワイプに対応した
// （031のボタンのみから覆した。ボタンは残す）
describe("PostCard の複数画像（033: 横スワイプ）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("2枚以上は横一列のScrollView（post-images-row）に並ぶ。1枚のときは使わない", () => {
    const { rerender } = render(<PostCard post={makePost({ images: makeImages(2) })} isOwn={false} />);
    expect(screen.getByTestId("post-images-row")).toBeTruthy();

    rerender(<PostCard post={makePostWithImage()} isOwn={false} />);
    expect(screen.queryByTestId("post-images-row")).toBeNull();
  });

  it("各画像はコンテナ幅の一部（ROW_ITEM_WIDTH_RATIO）で、コンテナいっぱいではない", () => {
    // 033・実機確認で発見: 横スクロールの中身は幅が定まらないコンテナに
    // なるため、子要素の幅はpx換算でonLayoutの実測値から算出する
    // （post-images.tsx）。onLayoutはjsdomでは発火しない（ResizeObserver
    // 依存）ため、ここでは「コンテナいっぱいの1.0ではなく1未満の比率で
    // 幅を決めている」という設計自体を固定する。実際に次の端が見える
    // 見え方はBrowser paneでの実機確認・人間の実機確認で担保する
    // （タスク定義2節「端がどれくらい見えれば気づくかは実機でしか分からない」）
    expect(ROW_ITEM_WIDTH_RATIO).toBeLessThan(1);
    expect(ROW_ITEM_WIDTH_RATIO).toBeGreaterThan(0.5);
  });

  it("ドットのインジケータを置かない（一覧行に見出し数字・ドット要素が無い）", () => {
    render(<PostCard post={makePost({ images: makeImages(3) })} isOwn={false} />);
    // 一覧行自体にはimage-viewer-counterに相当する要素を持たない
    // （カウンターはライトボックス側だけに出す。タスク定義2節・3節）
    expect(screen.queryByTestId("image-viewer-counter")).toBeNull();
  });

  it("ライトボックスをスワイプ（ScrollViewのonMomentumScrollEnd）で送ると枚数が更新される", () => {
    render(<PostCard post={makePost({ images: makeImages(3) })} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示（1枚目）"));
    expect(screen.getByTestId("image-viewer-counter").textContent).toBe("1 / 3");

    const scrollNode = screen.getByTestId("image-viewer-scroll");
    simulateSwipeTo(scrollNode, 800, 400);
    expect(screen.getByTestId("image-viewer-counter").textContent).toBe("3 / 3");

    simulateSwipeTo(scrollNode, 400, 400);
    expect(screen.getByTestId("image-viewer-counter").textContent).toBe("2 / 3");
  });

  it("スワイプで送ったあともボタンで続けて送れる（両方が効く）", () => {
    render(<PostCard post={makePost({ images: makeImages(3) })} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示（1枚目）"));

    simulateSwipeTo(screen.getByTestId("image-viewer-scroll"), 400, 400);
    expect(screen.getByTestId("image-viewer-counter").textContent).toBe("2 / 3");

    fireEvent.click(screen.getByTestId("image-viewer-next"));
    expect(screen.getByTestId("image-viewer-counter").textContent).toBe("3 / 3");
  });

  it("スワイプで背景タップの閉じる操作と混ざらない（送ったあとも開いたまま）", () => {
    render(<PostCard post={makePost({ images: makeImages(3) })} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示（1枚目）"));

    simulateSwipeTo(screen.getByTestId("image-viewer-scroll"), 400, 400);

    expect(screen.getByTestId("image-viewer-backdrop")).toBeTruthy();
    expect(screen.getByTestId("image-viewer-counter").textContent).toBe("2 / 3");
  });
});

// 041・T12: ビューアの保存ボタン。download が無い画像には出ない。投稿カードからのビューアは
// 保存ボタン以外が変わっていない（説明文・編集の導線が無い）
describe("ImageViewer の保存ボタン（041）", () => {
  beforeEach(() => {
    downloadUrlMock.mockReset();
  });

  it("download が無い画像には保存ボタンも説明文も出ない（033 までと同じ見え方）", () => {
    render(
      <ImageViewer visible images={[{ url: "https://example.com/a.jpg", width: 10, height: 10 }]} onClose={vi.fn()} />,
    );
    expect(screen.queryByTestId("image-viewer-download")).toBeNull();
    expect(screen.queryByTestId("image-viewer-caption")).toBeNull();
  });

  it("投稿カードからのビューアには保存ボタンだけが出て、説明文は出ない", () => {
    render(<PostCard post={makePostWithImage({ body: "本文はカードに見えている" })} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示"));

    expect(screen.getByTestId("image-viewer-download")).toHaveTextContent("保存");
    expect(screen.queryByTestId("image-viewer-caption")).toBeNull();
    // 閉じる導線・カウンター（1 枚なら無し）は 033 のまま
    expect(screen.getByTestId("image-viewer-close")).toBeTruthy();
    expect(screen.queryByTestId("image-viewer-counter")).toBeNull();
  });

  it("保存を押すと表示中の画像の ref（投稿 ID と位置）で photo.downloadUrl を呼び、<a download> を押す", async () => {
    downloadUrlMock.mockResolvedValue({ url: "https://r2.example.com/x?response-content-disposition=attachment", filename: "futary-20260816-X.jpg" });
    const clicked: string[] = [];
    const originalCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "a") {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          clicked.push(`${(el as HTMLAnchorElement).download}|${(el as HTMLAnchorElement).href}`);
        });
      }
      return el;
    });

    render(<PostCard post={makePost({ id: "post-9", images: makeImages(2) })} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示（2枚目）"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("image-viewer-download"));
      await Promise.resolve();
    });

    expect(downloadUrlMock).toHaveBeenCalledWith({ kind: "post", postId: "post-9", position: 1 });
    expect(clicked).toEqual(["futary-20260816-X.jpg|https://r2.example.com/x?response-content-disposition=attachment"]);
    // 保存ボタンを押してもビューアは閉じない（入れ子の Pressable が消費する）
    expect(screen.getByTestId("image-viewer-backdrop")).toBeTruthy();
    createSpy.mockRestore();
  });

  it("photo.downloadUrl が失敗したら「保存できませんでした」を出す", async () => {
    downloadUrlMock.mockRejectedValue(new Error("network"));
    render(<PostCard post={makePostWithImage()} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("image-viewer-download"));
      await Promise.resolve();
    });
    expect(await screen.findByText("保存できませんでした")).toBeTruthy();
  });
});

// 050: タイムラインの密度（T1〜T3）。高さの実測（T5）は artifacts/050/
describe("PostCard: 密度（050）", () => {
  it("T1: 名前と時刻が 1 行（同じ row の中に「投稿者 · たった今」）で、本文はその直下", () => {
    render(<PostCard post={makePost({ body: "本文です" })} isOwn={false} />);
    const line = screen.getByTestId("post-card-header-line");
    expect(line.textContent).toBe("投稿者 · たった今");
    expect(line.style.flexDirection).toBe("row");
    // 本文は名前の行と同じ列（右の列）にある = 名前の行の親の中に本文がある
    expect(line.parentElement?.textContent).toBe("投稿者 · たった今本文です");
  });

  it("T1: 全角 30 文字の名前でも時刻が描画される（名前だけが縮んで省略され、時刻は縮まない）", () => {
    const longName = "あ".repeat(30);
    render(<PostCard post={makePost({ authorName: longName })} isOwn={false} />);
    const author = screen.getByTestId("post-card-author");
    const time = screen.getByTestId("post-card-time");
    expect(author.textContent).toBe(longName);
    expect(time.textContent).toBe(" · たった今");
    // 名前は 1 行で省略（numberOfLines 1。react-native-web は class で textOverflow / whiteSpace を当てる）。
    // 包む View が縮む側（flexShrink 1・minWidth 0）
    expect(author.className).toMatch(/r-textOverflow-/);
    expect(author.className).toMatch(/r-whiteSpace-/);
    expect(author.parentElement?.style.flexShrink).toBe("1");
    expect(author.parentElement?.style.minWidth).toBe("0px");
    // 時刻は縮まない側
    expect(time.parentElement?.style.flexShrink).toBe("0");
  });

  it("T2: ハートは小さな押せる行（Button の compact）。文字 14/20 + 上下の余白 12 で当たり判定 44、上下 -8 のマージンで並びの上では 28。押すと onToggleReaction（reaction.toggle）", () => {
    const onToggle = vi.fn();
    render(<PostCard post={makePost()} isOwn={false} onToggleReaction={onToggle} />);
    const heart = screen.getByTestId("post-card-reaction-heart");
    // 当たり判定: 12 + 20 + 12 = 44（react-native-web の Pressable は hitSlop を DOM に反映しないので余白で作る）
    expect(heart.style.paddingTop).toBe("12px");
    expect(heart.style.paddingBottom).toBe("12px");
    // 並びの上の高さ: 44 - 8 - 8 = 28
    expect(heart.style.marginTop).toBe("-8px");
    expect(heart.style.marginBottom).toBe("-8px");
    const text = heart.firstElementChild as HTMLElement;
    expect(text.style.fontSize).toBe("14px");
    expect(text.style.lineHeight).toBe("20px");
    fireEvent.click(heart);
    expect(onToggle).toHaveBeenCalledWith("heart");
  });
});

// 050 T3: 画像 1 枚の高さの上限（singleImageLayout）。onLayout は jsdom で発火しないので、
// react-native-web が要素に付ける layout ハンドラ（__reactLayoutHandler）を直接呼んで幅を渡す
describe("PostImages: 画像 1 枚の高さの上限（050 T3）", () => {
  function fireLayout(testId: string, width: number) {
    const node = screen.getByTestId(testId) as HTMLElement & { __reactLayoutHandler?: (e: unknown) => void };
    expect(typeof node.__reactLayoutHandler).toBe("function");
    act(() => node.__reactLayoutHandler!({ nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } }));
  }

  it("singleImageLayout: 横長（幅いっぱいで高さ < 360）は幅 100%・aspectRatio。縦長（自然な高さ > 360）は高さ 360・幅は比率・左寄せ", () => {
    expect(MAX_SINGLE_IMAGE_HEIGHT).toBe(360);
    // 326 幅・4:3 → 自然な高さ 245 → そのまま
    expect(singleImageLayout(326, 4 / 3)).toEqual({ kind: "full", width: "100%", aspectRatio: 4 / 3 });
    // 326 幅・3:4 → 自然な高さ 435 → 360 に。幅 270・左寄せ
    expect(singleImageLayout(326, 3 / 4)).toEqual({ kind: "capped", width: 270, height: 360, alignSelf: "flex-start" });
    // 幅が分かる前（0）は幅いっぱい
    expect(singleImageLayout(0, 3 / 4)).toEqual({ kind: "full", width: "100%", aspectRatio: 3 / 4 });
    // ちょうど 360 は収まる
    expect(singleImageLayout(360, 1)).toEqual({ kind: "full", width: "100%", aspectRatio: 1 });
  });

  it("横長 1 枚: 幅を測ったあとも幅 100% で aspectRatio のまま", () => {
    render(<PostCard post={makePostWithImage({ images: [{ url: "https://example.com/w.jpg", width: 800, height: 600 }] })} isOwn={false} />);
    fireLayout("post-images-single", 326);
    const pressable = screen.getByTestId("post-images-single-full");
    const img = pressable.firstElementChild as HTMLElement;
    expect(img.style.width).toBe("100%");
    expect(img.style.aspectRatio).toBe(`${800 / 600} / 1`);
  });

  it("縦長 1 枚: 幅を測ると高さ 360・幅は比率（270）・左寄せ（alignSelf flex-start）", () => {
    render(<PostCard post={makePostWithImage({ images: [{ url: "https://example.com/t.jpg", width: 600, height: 800 }] })} isOwn={false} />);
    // 測る前は幅いっぱい
    expect(screen.getByTestId("post-images-single-full")).toBeTruthy();
    fireLayout("post-images-single", 326);
    const pressable = screen.getByTestId("post-images-single-capped");
    expect(pressable.style.alignSelf).toBe("flex-start");
    const img = pressable.firstElementChild as HTMLElement;
    expect(img.style.height).toBe("360px");
    expect(img.style.width).toBe("270px");
  });

  it("T4: 2〜4 枚は 033 のまま横一列（post-images-row）で、1 枚の上限は掛からない", () => {
    render(<PostCard post={makePost({ images: makeImages(2) })} isOwn={false} />);
    expect(screen.getByTestId("post-images-row")).toBeTruthy();
    expect(screen.queryByTestId("post-images-single")).toBeNull();
  });
});

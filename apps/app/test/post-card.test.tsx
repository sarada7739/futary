import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Post } from "@futary/contract";
import { PostCard } from "../components/post-card";

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

  it("タップした枚数目からライトボックスが開き、枚数が表示される（左右送り・スワイプにしない）", () => {
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

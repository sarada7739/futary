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
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
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
    imageUrl: "https://example.com/image.jpg",
    imageWidth: 800,
    imageHeight: 600,
    ...overrides,
  });
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

  it("画像自体のタップでは閉じない（外側のみが閉じる導線）", () => {
    render(<PostCard post={makePostWithImage()} isOwn={false} />);
    fireEvent.click(screen.getByLabelText("画像を全画面表示"));

    fireEvent.click(screen.getByTestId("image-viewer-image"));

    expect(screen.getByTestId("image-viewer-backdrop")).toBeTruthy();
  });

  it("画像が無い投稿では全画面表示の入口が無い", () => {
    render(<PostCard post={makePost({ imageUrl: null })} isOwn={false} />);
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

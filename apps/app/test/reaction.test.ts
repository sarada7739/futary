import { describe, expect, it } from "vitest";
import type { Post } from "@futary/contract";
import { toggleReactionOptimistically } from "../lib/reaction";

function makePost(reactions: Post["reactions"] = []): Post {
  return {
    id: "post-1",
    authorId: "me",
    authorName: "自分",
    authorImage: null,
    body: "こんにちは",
    images: [],
    createdAt: Math.floor(Date.now() / 1000),
    reactions,
  };
}

describe("toggleReactionOptimistically", () => {
  it("まだ何も付いていない投稿に付けると、件数1・reactedByMe: trueになる", () => {
    const post = makePost([]);

    const result = toggleReactionOptimistically(post, "heart");

    expect(result.reactions).toEqual([{ kind: "heart", count: 1, reactedByMe: true }]);
  });

  it("既に自分が付けている投稿から外すと、件数が減り reactedByMe: false になる", () => {
    const post = makePost([{ kind: "heart", count: 1, reactedByMe: true }]);

    const result = toggleReactionOptimistically(post, "heart");

    expect(result.reactions).toEqual([{ kind: "heart", count: 0, reactedByMe: false }]);
  });

  it("相手が付けている（自分は未反応）投稿に自分も付けると、件数が2になる", () => {
    const post = makePost([{ kind: "heart", count: 1, reactedByMe: false }]);

    const result = toggleReactionOptimistically(post, "heart");

    expect(result.reactions).toEqual([{ kind: "heart", count: 2, reactedByMe: true }]);
  });

  it("元の post オブジェクトを書き換えない（イミュータブル）", () => {
    const post = makePost([{ kind: "heart", count: 1, reactedByMe: true }]);

    const result = toggleReactionOptimistically(post, "heart");

    expect(post.reactions).toEqual([{ kind: "heart", count: 1, reactedByMe: true }]);
    expect(result).not.toBe(post);
  });
});

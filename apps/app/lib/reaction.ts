import type { Post } from "@futary/contract";

// 楽観的更新の見た目を作る純関数（巻き戻しをテストしやすく）。kind が無ければ足し、あれば件数と reactedByMe を反転する
export function toggleReactionOptimistically(post: Post, kind: string): Post {
  const existing = post.reactions.find((r) => r.kind === kind);
  const reactedByMe = !(existing?.reactedByMe ?? false);
  const count = Math.max(0, (existing?.count ?? 0) + (reactedByMe ? 1 : -1));

  const reactions = existing
    ? post.reactions.map((r) => (r.kind === kind ? { ...r, count, reactedByMe } : r))
    : [...post.reactions, { kind: kind as Post["reactions"][number]["kind"], count, reactedByMe }];

  return { ...post, reactions };
}

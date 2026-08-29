import type { Post } from "@futary/contract";

// post-card.tsx / app/(tabs)/index.tsx から使う純粋関数として切り出す
// （タスク009: 楽観的更新の巻き戻しをテストしやすくするため）。
// 対象の kind が無ければ新規追加、あれば件数と reactedByMe を反転させる。
// サーバ側の応答を待たず、タップした瞬間の見た目をこの関数で作る
export function toggleReactionOptimistically(post: Post, kind: string): Post {
  const existing = post.reactions.find((r) => r.kind === kind);
  const reactedByMe = !(existing?.reactedByMe ?? false);
  const count = Math.max(0, (existing?.count ?? 0) + (reactedByMe ? 1 : -1));

  const reactions = existing
    ? post.reactions.map((r) => (r.kind === kind ? { ...r, count, reactedByMe } : r))
    : [...post.reactions, { kind: kind as Post["reactions"][number]["kind"], count, reactedByMe }];

  return { ...post, reactions };
}

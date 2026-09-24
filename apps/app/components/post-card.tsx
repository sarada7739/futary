import { useState } from "react";
import { Pressable, View } from "react-native";
import { formatJstDate } from "@futary/date";
import { Avatar, Button, Card, space, Text } from "@futary/ui";
import type { Post } from "@futary/contract";
import { PostImages } from "./post-images";

type ReactionKind = Post["reactions"][number]["kind"];

export type PostCardProps = {
  post: Post;
  isOwn: boolean;
  // 削除は副作用のある操作。Button の二重発火の防止に乗せるので、await せずそのまま渡す（conventions.md 4節）
  onDelete?: () => void | Promise<void>;
  // リアクションも副作用のある操作
  onToggleReaction?: (kind: ReactionKind) => void | Promise<void>;
};

// タイムラインの密度: 1 行の投稿が 390pt 幅で 104pt 以下（050）。カードの余白 12×2 + 名前 20 + 本文 22 +
// ハートの行 28（当たり判定は 44。Button の compact）= 94、一覧の gap 8 で 102。アバター 36 は右の列（42）より低い
const AVATAR_SIZE = 36;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// 相対時刻（「3時間前」）。createdAt は Unix 秒
function relativeTimeFrom(createdAt: number, now = Date.now()): string {
  const diffSeconds = Math.max(0, Math.floor(now / 1000) - createdAt);
  if (diffSeconds < MINUTE) return "たった今";
  if (diffSeconds < HOUR) return `${Math.floor(diffSeconds / MINUTE)}分前`;
  if (diffSeconds < DAY) return `${Math.floor(diffSeconds / HOUR)}時間前`;
  if (diffSeconds < DAY * 7) return `${Math.floor(diffSeconds / DAY)}日前`;
  // timeZone を明示しないと端末のタイムゾーンで解釈され、JST の日付が 1 日ずれる
  return formatJstDate(createdAt);
}

// 自分の投稿の「…」メニュー。確認せず即削除しない
function DeleteMenu({ onDelete }: { onDelete: () => void | Promise<void> }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Pressable onPress={() => setConfirming(true)} hitSlop={8} testID="post-card-menu">
        <Text color="muted" size="lg">
          ⋯
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={{ flexDirection: "row", gap: space.xs }}>
      <Button variant="ghost" onPress={() => setConfirming(false)}>
        キャンセル
      </Button>
      <Button variant="secondary" onPress={onDelete}>
        削除
      </Button>
    </View>
  );
}

export function PostCard({ post, isOwn, onDelete, onToggleReaction }: PostCardProps) {
  // authorName は user 行が無いと null（architecture.md 5節）。代わりの表示に落とし、本文は必ず読めるようにする
  const authorName = post.authorName ?? "（削除されたユーザー）";
  const hasBody = post.body.trim().length > 0;
  // 今は heart の 1 種だけ
  const heart = post.reactions.find((r) => r.kind === "heart") ?? {
    kind: "heart" as const,
    count: 0,
    reactedByMe: false,
  };

  return (
    <Card padding="md" testID="post-card">
      {/* アバターの右に「名前 · 時刻」の 1 行、その直下に本文。画像は幅いっぱい（アバターの下にも掛かる）。
          ハートは小さな押せる行（050） */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <Avatar name={authorName} imageUrl={post.authorImage ?? undefined} size={AVATAR_SIZE} />
        <View style={{ flex: 1 }}>
          {/* 名前と時刻は別の Text を row に並べる（1 つの Text の numberOfLines だと末尾の時刻から省略される）。
              名前だけ縮んで省略され、時刻は常に描かれる。共有の Text は style を受けないので、縮む側は View で包む
              （minWidth 0 が無いと flex の子は中身の幅より縮まない） */}
          <View style={{ flexDirection: "row", alignItems: "baseline" }} testID="post-card-header-line">
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text size="sm" weight="bold" numberOfLines={1} testID="post-card-author">
                {authorName}
              </Text>
            </View>
            <View style={{ flexShrink: 0 }}>
              <Text size="sm" color="muted" testID="post-card-time">
                {` · ${relativeTimeFrom(post.createdAt)}`}
              </Text>
            </View>
          </View>
          {hasBody && <Text>{post.body}</Text>}
        </View>
        {isOwn && onDelete && <DeleteMenu onDelete={onDelete} />}
      </View>

      {/* postId を渡すとビューアに保存ボタンが出る */}
      {post.images.length > 0 && (
        <View style={{ marginTop: space.sm }}>
          <PostImages images={post.images} accessibilityLabel="画像を全画面表示" postId={post.id} />
        </View>
      )}

      {onToggleReaction && (
        <View style={{ flexDirection: "row" }}>
          <Button
            variant="ghost"
            compact
            onPress={() => onToggleReaction("heart")}
            testID="post-card-reaction-heart"
          >
            {`${heart.reactedByMe ? "❤️" : "🤍"}${heart.count > 0 ? ` ${heart.count}` : ""}`}
          </Button>
        </View>
      )}
    </Card>
  );
}

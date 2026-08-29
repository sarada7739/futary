import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { Avatar, Button, Card, colors, radius, space, Text } from "@futary/ui";
import type { Post } from "@futary/contract";

export type PostCardProps = {
  post: Post;
  isOwn: boolean;
  // 削除は副作用のある操作。ボタン側の二重発火防止（conventions.md 4節）に乗せるため
  // 呼び出し側では await せず Button にそのまま渡す
  onDelete?: () => void | Promise<void>;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// 投稿カードの相対時刻表示（「3時間前」）。createdAt は Unix秒
function relativeTimeFrom(createdAt: number, now = Date.now()): string {
  const diffSeconds = Math.max(0, Math.floor(now / 1000) - createdAt);
  if (diffSeconds < MINUTE) return "たった今";
  if (diffSeconds < HOUR) return `${Math.floor(diffSeconds / MINUTE)}分前`;
  if (diffSeconds < DAY) return `${Math.floor(diffSeconds / HOUR)}時間前`;
  if (diffSeconds < DAY * 7) return `${Math.floor(diffSeconds / DAY)}日前`;
  return new Date(createdAt * 1000).toLocaleDateString("ja-JP");
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

export function PostCard({ post, isOwn, onDelete }: PostCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  // architecture.md 5節: authorName は user 行が無いと null。代替表示に落とし、
  // 投稿本文は必ず読める状態を保つ
  const authorName = post.authorName ?? "（削除されたユーザー）";
  const hasBody = post.body.trim().length > 0;
  const aspectRatio = post.imageWidth && post.imageHeight ? post.imageWidth / post.imageHeight : 1;

  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Avatar name={authorName} imageUrl={post.authorImage ?? undefined} size={36} />
          <View style={{ flex: 1 }}>
            <Text weight="bold">{authorName}</Text>
            <Text size="xs" color="muted">
              {relativeTimeFrom(post.createdAt)}
            </Text>
          </View>
          {isOwn && onDelete && <DeleteMenu onDelete={onDelete} />}
        </View>

        {hasBody && <Text>{post.body}</Text>}

        {post.imageUrl &&
          (imageFailed ? (
            <View
              style={{
                padding: space.md,
                borderRadius: radius.input,
                backgroundColor: colors.surfaceTint,
                alignItems: "center",
              }}
            >
              <Text size="sm" color="muted">
                画像を読み込めませんでした
              </Text>
            </View>
          ) : (
            <Image
              source={{ uri: post.imageUrl }}
              style={{ width: "100%", aspectRatio, borderRadius: radius.input }}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          ))}
      </View>
    </Card>
  );
}

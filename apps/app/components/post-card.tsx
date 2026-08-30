import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { Avatar, Button, Card, colors, radius, space, Text } from "@futary/ui";
import type { Post } from "@futary/contract";
import { ImageViewer } from "./image-viewer";

type ReactionKind = Post["reactions"][number]["kind"];

export type PostCardProps = {
  post: Post;
  isOwn: boolean;
  // 削除は副作用のある操作。ボタン側の二重発火防止（conventions.md 4節）に乗せるため
  // 呼び出し側では await せず Button にそのまま渡す
  onDelete?: () => void | Promise<void>;
  // リアクションも同様に副作用のある操作（タスク009）
  onToggleReaction?: (kind: ReactionKind) => void | Promise<void>;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// 投稿カードの相対時刻表示（「3時間前」）。createdAt は Unix秒。
// 経過時間の比較・ロケール表示のみでJSTの暦日計算ではないためpackages/date対象外
// eslint-disable-next-line no-restricted-syntax
function relativeTimeFrom(createdAt: number, now = Date.now()): string {
  const diffSeconds = Math.max(0, Math.floor(now / 1000) - createdAt);
  if (diffSeconds < MINUTE) return "たった今";
  if (diffSeconds < HOUR) return `${Math.floor(diffSeconds / MINUTE)}分前`;
  if (diffSeconds < DAY) return `${Math.floor(diffSeconds / HOUR)}時間前`;
  if (diffSeconds < DAY * 7) return `${Math.floor(diffSeconds / DAY)}日前`;
  // eslint-disable-next-line no-restricted-syntax
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

export function PostCard({ post, isOwn, onDelete, onToggleReaction }: PostCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  // architecture.md 5節: authorName は user 行が無いと null。代替表示に落とし、
  // 投稿本文は必ず読める状態を保つ
  const authorName = post.authorName ?? "（削除されたユーザー）";
  const hasBody = post.body.trim().length > 0;
  const aspectRatio = post.imageWidth && post.imageHeight ? post.imageWidth / post.imageHeight : 1;
  // まず heart の1種だけ（state.md 論点L4）
  const heart = post.reactions.find((r) => r.kind === "heart") ?? {
    kind: "heart" as const,
    count: 0,
    reactedByMe: false,
  };

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
            // 開く操作に副作用は無いため二重発火ガードは不要（conventions.md 4節。
            // 017の確認観点）。生のPressableでよい
            <Pressable onPress={() => setViewerOpen(true)} accessibilityRole="button" accessibilityLabel="画像を全画面表示">
              <Image
                source={{ uri: post.imageUrl }}
                style={{ width: "100%", aspectRatio, borderRadius: radius.input }}
                resizeMode="cover"
                onError={() => setImageFailed(true)}
              />
            </Pressable>
          ))}

        {post.imageUrl && (
          <ImageViewer visible={viewerOpen} imageUrl={post.imageUrl} onClose={() => setViewerOpen(false)} />
        )}

        {onToggleReaction && (
          <View style={{ flexDirection: "row" }}>
            <Button
              variant="ghost"
              onPress={() => onToggleReaction("heart")}
              testID="post-card-reaction-heart"
            >
              {`${heart.reactedByMe ? "❤️" : "🤍"}${heart.count > 0 ? ` ${heart.count}` : ""}`}
            </Button>
          </View>
        )}
      </View>
    </Card>
  );
}

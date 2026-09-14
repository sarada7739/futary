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
  // 削除は副作用のある操作。ボタン側の二重発火防止（conventions.md 4節）に乗せるため
  // 呼び出し側では await せず Button にそのまま渡す
  onDelete?: () => void | Promise<void>;
  // リアクションも同様に副作用のある操作（タスク009）
  onToggleReaction?: (kind: ReactionKind) => void | Promise<void>;
};

// 050: タイムラインの密度（タスク定義 0節）。文字 1 行の投稿が 390pt 幅で 104pt 以下になる配分（B が決めた）:
// カードの余白 md（12）× 2 + 名前の行（sm・20）+ 本文（md・22）+ ハートの行（並びの上で 28。当たり判定は 44。
// Button の compact）= 94。一覧の gap 8 を足して 102。アバターは 36 で、右の列（名前の行 + 本文 = 42）より低い
const AVATAR_SIZE = 36;

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
  // timeZone を明示しないと端末のタイムゾーンで解釈され、JST基準の投稿日付が
  // 1日ずれる（L64。Rレビュー指摘）
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
  // architecture.md 5節: authorName は user 行が無いと null。代替表示に落とし、
  // 投稿本文は必ず読める状態を保つ
  const authorName = post.authorName ?? "（削除されたユーザー）";
  const hasBody = post.body.trim().length > 0;
  // まず heart の1種だけ（state.md 論点L4）
  const heart = post.reactions.find((r) => r.kind === "heart") ?? {
    kind: "heart" as const,
    count: 0,
    reactedByMe: false,
  };

  return (
    <Card padding="md" testID="post-card">
      {/* 050: X の 1 ポストの形。アバターの右に「名前 · 時刻」の 1 行、その直下に本文（gap 無し。行間で足りる）。
          画像は幅いっぱい（アバターの下にも掛かる）。ハートは小さな押せる行 */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <Avatar name={authorName} imageUrl={post.authorImage ?? undefined} size={AVATAR_SIZE} />
        <View style={{ flex: 1 }}>
          {/* 名前と時刻は別の Text を row に並べる（1 つの Text に numberOfLines を掛けると末尾の時刻から
              省略される。R の 050 レビュー記録 3）。名前だけ縮んで省略され、時刻は常に描かれる。
              共有 Text は style を受けないので、縮む側は View で包む（minWidth 0 が無いと flex の子は
              中身の幅より縮まない） */}
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

      {/* 041: postId を渡すとビューアに保存ボタンが出る（タイムラインの写真も保存できる） */}
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

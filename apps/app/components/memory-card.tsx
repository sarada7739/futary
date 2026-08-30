import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import type { MemoryLabel } from "@futary/contract";
import { formatJstDate } from "@futary/date";
import { Card, radius, space, Text } from "@futary/ui";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/orpc";
import { ImageViewer } from "./image-viewer";

const LABELS: Record<MemoryLabel, string> = {
  oneMonthAgo: "1ヶ月前の今日",
  halfYearAgo: "半年前の今日",
  oneYearAgo: "1年前の今日",
  random: "あの日の思い出",
};

export function MemoryCard() {
  const query = useQuery(orpc.memory.get.queryOptions());
  const [viewerOpen, setViewerOpen] = useState(false);

  // 該当なし（null）・読み込み中・通信エラーはすべてカードごと非表示にする
  // （タスク定義の確認観点「nullのときにカードが消え、ホームのレイアウトが
  // 崩れないか」。統計カードと違いこちらは補助的なコンテンツのため、
  // 骨格表示は設けずそのまま出さない）
  if (query.isLoading || query.isError || !query.data) return null;

  const { post, label } = query.data;
  const hasBody = post.body.trim().length > 0;
  const aspectRatio = post.imageWidth && post.imageHeight ? post.imageWidth / post.imageHeight : 1;

  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Text weight="bold" color="brand">
            {LABELS[label]}
          </Text>
          <Text size="xs" color="muted">
            {formatJstDate(post.createdAt)}
          </Text>
        </View>

        {post.imageUrl && (
          // タップで元の投稿へ遷移する、とタスク定義にあるが、この画面
          // （ホームのタイムライン）には投稿ごとの個別ルートが無い
          // （FlatListの無限スクロールのみ）。既存の画像表示パターン
          // （017のImageViewer。post-card.tsxと同じ使い方）を再利用し、
          // タップで画像を全画面表示する形にした
          <Pressable
            onPress={() => setViewerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="思い出の投稿を表示"
          >
            <Image
              source={{ uri: post.imageUrl }}
              style={{ width: "100%", aspectRatio, borderRadius: radius.input }}
              resizeMode="cover"
            />
          </Pressable>
        )}

        {hasBody && (
          <Text size="sm" numberOfLines={2}>
            {post.body}
          </Text>
        )}
      </View>

      {post.imageUrl && (
        <ImageViewer visible={viewerOpen} imageUrl={post.imageUrl} onClose={() => setViewerOpen(false)} />
      )}
    </Card>
  );
}

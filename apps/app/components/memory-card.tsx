import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { MemoryLabel } from "@futary/contract";
import { formatJstDate } from "@futary/date";
import { Button, Card, space, Text } from "@futary/ui";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/orpc";
import { useViewerQueryKey } from "../lib/viewer-key";
import { PostImages } from "./post-images";

const LABELS: Record<MemoryLabel, string> = {
  oneMonthAgo: "1ヶ月前の今日",
  halfYearAgo: "半年前の今日",
  oneYearAgo: "1年前の今日",
  random: "あの日の思い出",
};

export function MemoryCard() {
  // queryKey に viewerKey を含める（lib/viewer-key.ts。T9）
  const viewerKey = useViewerQueryKey();
  const query = useQuery({
    ...orpc.memory.get.queryOptions(),
    queryKey: [...orpc.memory.get.queryOptions().queryKey, viewerKey],
  });
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const postId = query.data?.post.id;

  // 日をまたいで別の投稿に変わったとき、展開していた状態を持ち越さない
  useEffect(() => {
    setBodyExpanded(false);
  }, [postId]);

  // このカードが思い出の画面の唯一の中身なので、読み込み中・エラーを無表示にすると何が起きているか分からない。
  // 読み込み中・エラーは他画面と同じ表示、該当なし（正当な空状態）だけ案内文
  if (query.isLoading) {
    return (
      <View style={{ alignItems: "center", padding: space.xl }}>
        <Text color="muted">読み込み中…</Text>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={{ alignItems: "center", gap: space.md, padding: space.xl }}>
        <Text color="muted">思い出を読み込めませんでした</Text>
        <Button
          onPress={async () => {
            await query.refetch();
          }}
        >
          再試行
        </Button>
      </View>
    );
  }

  if (!query.data) {
    return (
      <View style={{ alignItems: "center", padding: space.xl }}>
        <Text color="muted">今日に関する思い出はまだありません</Text>
      </View>
    );
  }

  const { post, label } = query.data;
  const hasBody = post.body.trim().length > 0;

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

        {/* 投稿ごとの個別ルートは無いので、押したら元の投稿へ飛ぶ代わりに画像を全画面で出す（post-card.tsx と同じ） */}
        <PostImages images={post.images} accessibilityLabel="思い出の投稿を表示" postId={post.id} />

        {hasBody && (
          // 画像とは別の当たり判定。テキストだけの思い出（4 段目のランダムは画像を優先しない）では、本文を最後まで
          // 読む手段が無くなる。省略が起きているかは判定せず、本文があれば常にタップで展開できる（conventions.md 6節）
          <Pressable
            onPress={() => setBodyExpanded((expanded) => !expanded)}
            accessibilityRole="button"
            accessibilityLabel={bodyExpanded ? "本文を折りたたむ" : "本文をすべて表示"}
          >
            <Text size="sm" numberOfLines={bodyExpanded ? undefined : 2}>
              {post.body}
            </Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

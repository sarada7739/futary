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
  // queryKeyにviewerKeyを含める理由はapps/app/lib/viewer-key.ts参照
  // （T9。coupleIdを引数に取らない問い合わせは識別をキーに含めて区別する）
  const viewerKey = useViewerQueryKey();
  const query = useQuery({
    ...orpc.memory.get.queryOptions(),
    queryKey: [...orpc.memory.get.queryOptions().queryKey, viewerKey],
  });
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const postId = query.data?.post.id;

  // 日をまたいでmemory.getが再取得され別の投稿に変わったとき、前の投稿で
  // 展開していた状態を持ち越さない
  useEffect(() => {
    setBodyExpanded(false);
  }, [postId]);

  // 016: memory.tsx（思い出タブ）がこのカードだけを描画する構成になった
  // （旧タスク定義時点ではホームの補助パネルの1つだったため、当時は
  // 読み込み中・エラー・該当なしをすべて非表示にしても他の要素が画面を
  // 埋めていた。現在はこのカードが画面の唯一の内容なので、無表示のままだと
  // 画面がほぼ空白のまま何が起きているか分からなくなる。security-auditor
  // 全体監査・3状態レビュー指摘）。読み込み中・エラーは他画面と同じ表示に、
  // 該当なし（今日に該当する思い出が無い。正当な空状態）だけは案内文を出す
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

        {/* タップで元の投稿へ遷移する、とタスク定義にあるが、この画面
            （ホームのタイムライン）には投稿ごとの個別ルートが無い
            （FlatListの無限スクロールのみ）。既存の画像表示パターン
            （017のImageViewer・031のPostImages。post-card.tsxと同じ使い方）を
            再利用し、タップで画像を全画面表示する形にした */}
        <PostImages images={post.images} accessibilityLabel="思い出の投稿を表示" />

        {hasBody && (
          // 画像タップ（全画面表示）とは別の当たり判定。テキストのみの思い出
          // （探索4段目のランダム選択は画像を優先しないため起こりうる）には
          // タップできる要素が画像側に無く、本文を最後まで読む手段が無くなる
          // 穴があった（Rレビュー指摘・Aのタスク定義更新）。当たり判定の
          // 正確さに依存させない（conventions.md 6節）ため、実際に省略が
          // 起きているかどうかを判定せず、本文があれば常にタップで
          // 展開/折りたたみできる形にした
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

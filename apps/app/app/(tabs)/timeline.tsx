import { Button, colors, Screen, space, Text } from "@futary/ui";
import { useInfiniteQuery, useMutation, type InfiniteData } from "@tanstack/react-query";
import type { Post } from "@futary/contract";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { PostCard } from "../../components/post-card";
import { useSession } from "../../lib/auth-client";
import { useGuestMode } from "../../lib/guest-mode";
import { orpc } from "../../lib/orpc";
import { POST_LIST_REFETCH_INTERVAL_MS, queryClient } from "../../lib/query";
import { toggleReactionOptimistically } from "../../lib/reaction";
import { useViewerQueryKey } from "../../lib/viewer-key";

type PostListPage = { items: Post[]; nextCursor: string | null };

// 020: 投稿一覧はホームから独立したタブになった。008の実装をそのまま移し、
// ロゴ・統計カード・思い出しカード（ホームの記念日カード・パネルへ移動）だけ外した
export default function TimelineScreen() {
  const router = useRouter();
  const { data: session } = useSession();
  const myId = session?.user.id;
  const { isGuestMode, exitGuestMode } = useGuestMode();

  // queryKeyにviewerKeyを含める理由はapps/app/lib/viewer-key.ts参照（T9）。
  // orpc.post.list.key()を使う下のinvalidateQueries/setQueriesData等は
  // 部分一致（前方一致）で効くため、末尾にviewerKeyを追加しても壊れない
  const viewerKey = useViewerQueryKey();
  const postListOptions = orpc.post.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ cursor }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // ADR-008: 画面前面にある間だけ更新する（背景では focusManager が止める。lib/query.ts）
    refetchInterval: POST_LIST_REFETCH_INTERVAL_MS,
  });
  const query = useInfiniteQuery({
    ...postListOptions,
    queryKey: [...postListOptions.queryKey, viewerKey],
  });

  const deletePost = useMutation(
    orpc.post.delete.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.post.list.key() }),
    }),
  );

  // タップした瞬間に反映し、失敗したら戻す（タスク009・楽観的更新）。
  // onMutate でキャッシュを直接書き換え、サーバ応答を待たない
  const toggleReaction = useMutation(
    orpc.reaction.toggle.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries({ queryKey: orpc.post.list.key() });
        const previousQueries = queryClient.getQueriesData<InfiniteData<PostListPage>>({
          queryKey: orpc.post.list.key(),
        });
        queryClient.setQueriesData<InfiniteData<PostListPage>>(
          { queryKey: orpc.post.list.key() },
          (old) =>
            old && {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((item) =>
                  item.id === input.postId ? toggleReactionOptimistically(item, input.kind) : item,
                ),
              })),
            },
        );
        return { previousQueries };
      },
      // 失敗したら onMutate で保存した以前の状態に戻す
      onError: (_error, _input, context) => {
        // viewer-key-coverage-ignore -- keyはgetQueriesDataが返した実際のキー（既にviewerKeyを含む）をそのまま書き戻すだけで、固定キーではない
        context?.previousQueries.forEach(([key, data]) => queryClient.setQueryData(key, data));
      },
      // 成功時は再フェッチしない。post.list は呼ぶたびに画像の署名付きURLを
      // 発行し直すため（architecture.md 6節）、ここで invalidateQueries すると
      // 自分の投稿以外も含めて画像URLが変わり、<Image> が再読み込みされて
      // 一覧全体がちらつく（人間の実機確認で発見）。相手の操作との同期は
      // 60秒ごとのポーリング（refetchInterval・ADR-008）に任せ、楽観的更新の
      // 結果をそのまま信頼する
    }),
  );

  const posts = query.data?.pages.flatMap((page) => page.items) ?? [];

  // 状態1: 読み込み中（初回のみ。ページ内既存データがある再取得はスピナーを出さない）
  if (query.isLoading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </Screen>
    );
  }

  // 状態2: 通信エラー（データが1件も無い場合のみ全面表示。既にデータがあれば
  // 一覧は見せたまま、次回のポーリング/pull-to-refreshに任せる）
  if (query.isError && posts.length === 0) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }}>
          <Text color="muted">投稿を読み込めませんでした</Text>
          <Button variant="secondary" onPress={async () => { await query.refetch(); }}>
            再試行
          </Button>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
      data={posts}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: space.lg, gap: space.md, flexGrow: 1 }}
      ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
      renderItem={({ item }) => {
        const isOwn = item.authorId === myId;
        return (
          <PostCard
            post={item}
            isOwn={isOwn}
            onDelete={isOwn ? async () => { await deletePost.mutateAsync({ id: item.id }); } : undefined}
            // 未認証（デモ閲覧）ではサーバが FORBIDDEN を返すだけで境界は破れないが、
            // 押しても黙って巻き戻るだけの体験を避けるためボタン自体を出さない
            // （M2まとめ監査 Low指摘）
            onToggleReaction={
              myId
                ? async (kind) => {
                    await toggleReaction.mutateAsync({ postId: item.id, kind });
                  }
                : undefined
            }
          />
        );
      }}
      // 状態3: 投稿ゼロ
      ListEmptyComponent={
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md }}>
          <Text color="muted">まだ投稿がありません</Text>
          <Button
            variant="secondary"
            onPress={() => (isGuestMode ? exitGuestMode() : router.push("/compose"))}
          >
            {isGuestMode ? "ログインして投稿する" : "最初の思い出を残そう"}
          </Button>
        </View>
      }
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => query.refetch()}
          tintColor={colors.primary}
        />
      }
      ListFooterComponent={
        query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ marginVertical: space.md }} /> : null
      }
      />
    </Screen>
  );
}

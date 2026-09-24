import { Button, Screen, space, Text, useTheme } from "@futary/ui";
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
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

type PostListPage = { items: Post[]; nextCursor: string | null };

// 投稿の一覧（ホームから独立したタブ。020）
export default function TimelineScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { data: session } = useSession();
  const myId = session?.user.id;
  const { isGuestMode, exitGuestMode } = useGuestMode();

  // queryKey に viewerKey を含める（lib/viewer-key.ts。T9）。post.list.key() を使う invalidate・setQueriesData は
  // 前方一致なので、末尾に viewerKey を足しても効く
  const viewerKey = useViewerQueryKey();
  const postListOptions = orpc.post.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ cursor }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // 画面が前面にある間だけ更新する（背景では focusManager が止める。ADR-008）
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

  // 押した瞬間に反映し、失敗したら戻す（楽観的更新。サーバの応答を待たない）
  const toggleReaction = useMutation(
    orpc.reaction.toggle.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries({ queryKey: orpc.post.list.key() });
        // viewer-key-coverage-ignore -- 戻り値（各要素は[実際のkey, data]の組。keyは既にviewerKeyを含む）はcontext経由でonErrorのsetQueryDataへ、同じkeyへそのまま書き戻すためだけに使う。画面には表示しない
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
      // 失敗したら onMutate で保存した状態に戻す
      onError: (_error, _input, context) => {
        // viewer-key-coverage-ignore -- keyはgetQueriesDataが返した実際のキー（既にviewerKeyを含む）をそのまま書き戻すだけで、固定キーではない
        context?.previousQueries.forEach(([key, data]) => queryClient.setQueryData(key, data));
      },
      // 成功しても再取得しない。post.list は呼ぶたびに署名付き URL を発行し直すので、画像が読み直されて
      // 一覧全体がちらつく（architecture.md 6節）。相手の操作は 60 秒ごとのポーリングに任せる（ADR-008）
    }),
  );

  const posts = query.data?.pages.flatMap((page) => page.items) ?? [];

  // 状態1: 読み込み中（初回だけ。データがある再取得ではスピナーを出さない）
  if (query.isLoading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </Screen>
    );
  }

  // 状態2: 通信エラー（1 件も無いときだけ全面に出す。あれば一覧は見せたまま、ポーリング・引っ張って更新に任せる）
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
      // カードの間は sm（8）。間は ItemSeparatorComponent だけで作る（gap も足すと二重に掛かって 20 になる）
      contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, flexGrow: 1 }}
      ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
      renderItem={({ item }) => {
        const isOwn = item.authorId === myId;
        return (
          <PostCard
            post={item}
            isOwn={isOwn}
            onDelete={isOwn ? async () => { await deletePost.mutateAsync({ id: item.id }); } : undefined}
            // デモ閲覧ではサーバが FORBIDDEN を返すだけだが、押して黙って巻き戻るのを避けるためボタンを出さない
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

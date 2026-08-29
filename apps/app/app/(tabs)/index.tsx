import { Button, colors, logoMark, Screen, space, Text } from "@futary/ui";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Image, RefreshControl, View } from "react-native";
import { PostCard } from "../../components/post-card";
import { useSession } from "../../lib/auth-client";
import { orpc } from "../../lib/orpc";
import { POST_LIST_REFETCH_INTERVAL_MS, queryClient } from "../../lib/query";

const LOGO_WIDTH = 96;
const LOGO_HEIGHT = 34;

export default function HomeScreen() {
  const router = useRouter();
  const { data: session } = useSession();
  const myId = session?.user.id;

  const query = useInfiniteQuery(
    orpc.post.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      // ADR-008: 画面前面にある間だけ更新する（背景では focusManager が止める。lib/query.ts）
      refetchInterval: POST_LIST_REFETCH_INTERVAL_MS,
    }),
  );

  const deletePost = useMutation(
    orpc.post.delete.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.post.list.key() }),
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
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }}
        >
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
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.md }}>
            <Image
              source={logoMark}
              style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
              resizeMode="contain"
            />
            {/* 統計カード（012）・思い出しカード（013）の置き場所。ここに追加する */}
          </View>
        }
        renderItem={({ item }) => {
          const isOwn = item.authorId === myId;
          return (
            <PostCard
              post={item}
              isOwn={isOwn}
              onDelete={isOwn ? async () => { await deletePost.mutateAsync({ id: item.id }); } : undefined}
            />
          );
        }}
        // 状態3: 投稿ゼロ
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md }}>
            <Text color="muted">まだ投稿がありません</Text>
            <Button variant="secondary" onPress={() => router.push("/compose")}>
              最初の思い出を残そう
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
          query.isFetchingNextPage ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: space.md }} />
          ) : null
        }
      />
    </Screen>
  );
}

import { isDefinedError } from "@orpc/client";
import { Screen } from "@futary/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useSession } from "../lib/auth-client";
import { orpc } from "../lib/orpc";
import { queryClient } from "../lib/query";

function RootNavigator() {
  const { data: session, isPending: isSessionPending } = useSession();
  const isAuthenticated = !!session;

  // couple.get は未所属なら NEEDS_ONBOARDING を投げる（architecture.md 5節）。
  // 未認証のときは呼ばない（enabled: isAuthenticated）
  const { data: couple, error: coupleError, isLoading: isCoupleLoading } = useQuery({
    ...orpc.couple.get.queryOptions(),
    enabled: isAuthenticated,
    retry: false,
  });

  if (isSessionPending || (isAuthenticated && isCoupleLoading)) {
    return <Screen>{null}</Screen>;
  }

  const hasCouple = isAuthenticated && !!couple;
  const needsOnboarding =
    isAuthenticated && !couple && isDefinedError(coupleError) && coupleError.code === "NEEDS_ONBOARDING";

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={hasCouple}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="compose"
          options={{ presentation: "modal", headerShown: true, title: "投稿する" }}
        />
        {/* 020: ホームの機能パネル「思い出」「統計」の行き先。モーダルではなく
            通常の画面遷移（戻る導線はヘッダーの標準の戻るボタン） */}
        <Stack.Screen name="memory" options={{ headerShown: true, title: "思い出" }} />
        <Stack.Screen name="stats" options={{ headerShown: true, title: "統計" }} />
      </Stack.Protected>
      <Stack.Protected guard={needsOnboarding}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* 認証済みだが couple.get が NEEDS_ONBOARDING 以外のエラー（通信断等）を
          返している間はどちらにも倒さない。isLoading が false になったあとの
          一瞬だけ発生しうる、意図的な空表示 */}
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <RootNavigator />
    </QueryClientProvider>
  );
}

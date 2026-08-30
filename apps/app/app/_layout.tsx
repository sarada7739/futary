import { useState } from "react";
import { isDefinedError } from "@orpc/client";
import { Screen } from "@futary/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { DemoBanner } from "../components/demo-banner";
import { useSession } from "../lib/auth-client";
import { GuestModeContext } from "../lib/guest-mode";
import { orpc } from "../lib/orpc";
import { queryClient } from "../lib/query";

function RootNavigator() {
  const { data: session, isPending: isSessionPending } = useSession();
  const isAuthenticated = !!session;
  // 014: サインイン画面の「ゲストではじめる」で入る、未認証のデモ閲覧モード。
  // 実際に認証済みになったら意味を持たない（isAuthenticatedが優先）
  const [isGuestMode, setIsGuestMode] = useState(false);
  const isDemoViewer = !isAuthenticated && isGuestMode;

  // couple.get は未所属なら NEEDS_ONBOARDING を投げる（architecture.md 5節）。
  // 未認証・非デモのときは呼ばない（enabled: isAuthenticated || isDemoViewer）
  const { data: couple, error: coupleError, isLoading: isCoupleLoading } = useQuery({
    ...orpc.couple.get.queryOptions(),
    enabled: isAuthenticated || isDemoViewer,
    retry: false,
  });

  const hasCouple = (isAuthenticated || isDemoViewer) && !!couple;
  const needsOnboarding =
    isAuthenticated && !couple && isDefinedError(coupleError) && coupleError.code === "NEEDS_ONBOARDING";

  if (isSessionPending || ((isAuthenticated || isDemoViewer) && isCoupleLoading)) {
    return <Screen>{null}</Screen>;
  }

  return (
    <GuestModeContext.Provider
      value={{
        isGuestMode: isDemoViewer,
        enterGuestMode: () => setIsGuestMode(true),
        // サインイン画面へ戻る。guardが!isAuthenticated && !isGuestModeになった
        // 瞬間に(auth)スタックが表示される（明示的なnavigateは要らない）。
        //
        // 既知の制約（artifacts/014/manual-check.md に記録。人間の実機確認待ち）:
        // Expo Routerの Stack.Protected は「guardがfalseになった画面から自動で
        // 退出する」方向は扱うが、逆（guardが新しくtrueになったグループへ自動で
        // 入る）は扱わない。サインイン画面に戻ったあと同一ページ内で再度
        // 「ゲストではじめる」を押すと、バナーだけ出て画面が遷移しないことがある
        // （実測）。ブラウザの再読み込みで復帰できる
        exitGuestMode: () => setIsGuestMode(false),
      }}
    >
      {isDemoViewer && <DemoBanner />}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={hasCouple}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="compose"
            options={{ presentation: "modal", headerShown: true, title: "投稿する" }}
          />
        </Stack.Protected>
        <Stack.Protected guard={needsOnboarding}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Protected guard={!isAuthenticated && !isDemoViewer}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* 認証済みだが couple.get が NEEDS_ONBOARDING 以外のエラー（通信断等）を
            返している間はどちらにも倒さない。isLoading が false になったあとの
            一瞬だけ発生しうる、意図的な空表示 */}
      </Stack>
    </GuestModeContext.Provider>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <RootNavigator />
    </QueryClientProvider>
  );
}

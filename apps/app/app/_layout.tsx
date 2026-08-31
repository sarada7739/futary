import { useEffect, useState } from "react";
import { isDefinedError } from "@orpc/client";
import { Screen } from "@futary/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { DemoBanner } from "../components/demo-banner";
import { useSession } from "../lib/auth-client";
import { GuestModeContext } from "../lib/guest-mode";
import { orpc } from "../lib/orpc";
import { queryClient } from "../lib/query";
import { resolveRootRoute } from "../lib/root-route";

function RootNavigator() {
  const { data: session, isPending: isSessionPending } = useSession();
  const isAuthenticated = !!session;
  // 014: サインイン画面の「ゲストではじめる」で入る、未認証のデモ閲覧モード。
  // 実際に認証済みになったら意味を持たない（isAuthenticatedが優先）
  const [isGuestMode, setIsGuestMode] = useState(false);
  // デモの解決に失敗してサインイン画面へ戻された直後だけtrue。理由を1行
  // 出すために使う（architecture.md 3節。Rレビュー指摘R-1・A決定）。
  // 次に「ゲストではじめる」を押したら消す
  const [demoUnavailable, setDemoUnavailable] = useState(false);
  const isDemoViewer = !isAuthenticated && isGuestMode;

  // couple.get は未所属なら NEEDS_ONBOARDING を投げる（architecture.md 5節）。
  // 未認証・非デモのときは呼ばない（enabled: isAuthenticated || isDemoViewer）
  const { data: couple, error: coupleError, isLoading: isCoupleLoading } = useQuery({
    ...orpc.couple.get.queryOptions(),
    enabled: isAuthenticated || isDemoViewer,
    retry: false,
  });

  // ガード判定はlib/root-route.tsの純関数に切り出してある（Rレビュー指摘R-1:
  // デモ閲覧中にcouple.getが失敗すると、3つのguardのどれもtrueにならず
  // バナーだけ出た空白画面から再読み込みでしか戻れなくなっていた。
  // demoFailedがそれを拾い、サインイン画面へ落とす）
  const { hasCouple, needsOnboarding, showAuth, demoFailed } = resolveRootRoute({
    isAuthenticated,
    isDemoViewer,
    isCoupleLoading,
    hasCoupleData: !!couple,
    isNeedsOnboardingError: isDefinedError(coupleError) && coupleError.code === "NEEDS_ONBOARDING",
  });

  useEffect(() => {
    if (demoFailed) {
      setIsGuestMode(false);
      setDemoUnavailable(true);
    }
  }, [demoFailed]);

  if (isSessionPending || ((isAuthenticated || isDemoViewer) && isCoupleLoading)) {
    return <Screen>{null}</Screen>;
  }

  return (
    <GuestModeContext.Provider
      value={{
        isGuestMode: isDemoViewer,
        enterGuestMode: () => {
          setDemoUnavailable(false);
          setIsGuestMode(true);
        },
        // サインイン画面へ戻る。guardが!isAuthenticated && !isGuestModeになった
        // 瞬間に(auth)スタックが表示される（明示的なnavigateは要らない）
        exitGuestMode: () => setIsGuestMode(false),
        demoUnavailable,
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
        <Stack.Protected guard={showAuth}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* 認証済みの利用者がcouple.getでNEEDS_ONBOARDING以外のエラー（通信断等）を
            受けている間は、hasCouple・needsOnboarding・showAuthのどれも
            trueにならない一瞬が生じうる（再試行でじきに解消する）。
            ゲストの失敗はここに含まれない。showAuthのdemoFailedが別に
            受け止め、サインイン画面へ理由付きで戻す（architecture.md 3節。
            「一瞬だけ起きる空表示」という説明は認証済み利用者の話であり、
            ゲストには当てはまらない。A決定） */}
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

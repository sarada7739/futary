import { useEffect, useRef, useState } from "react";
import { isDefinedError } from "@orpc/client";
import { Button, Screen, Text, space } from "@futary/ui";
import { View } from "react-native";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { DemoBanner } from "../components/demo-banner";
import { useSession } from "../lib/auth-client";
import { GuestModeContext } from "../lib/guest-mode";
import { orpc } from "../lib/orpc";
import { queryClient } from "../lib/query";
import { resolveRootRoute } from "../lib/root-route";
import { useViewerQueryKeyFrom } from "../lib/viewer-key";

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
  // 未認証・非デモのときは呼ばない（enabled: isAuthenticated || isDemoViewer）。
  //
  // queryKeyにviewerKeyを含める理由: couple.getはcoupleIdを引数に取らない
  // ため、TanStack Queryのキャッシュキーだけでは「誰が呼んだか」を区別
  // できない。リロード無しで本物のログイン⇄ゲスト⇄未認証を切り替えると、
  // 直前の別人のキャッシュ（データまたはエラー）がそのまま画面に一瞬出る
  // 不具合が実機で発生した（security-requirements.md T9。共有端末では
  // 実質的な情報漏洩になる）。`useEffect`でのqueryClient.clear()は
  // レンダー後に走るため、識別が変わった最初のレンダーには間に合わず
  // 窓を閉じきれない（Rレビュー指摘・A決定）。識別をキー自体に含めることで、
  // 識別が変わった時点で必ず別のキャッシュ枠（＝isLoading:trueから開始）
  // になり、他人のキャッシュを読む経路自体を無くす
  const viewerKey = useViewerQueryKeyFrom(isDemoViewer);
  const {
    data: couple,
    error: coupleError,
    isLoading: isCoupleLoading,
    refetch: refetchCouple,
  } = useQuery({
    ...orpc.couple.get.queryOptions(),
    queryKey: [...orpc.couple.get.queryOptions().queryKey, viewerKey],
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

  // 【016でA決定・訂正】以前はこのeffectのqueryClient.clear()を
  // 「正しさの担保」として書いていたが、それは誤りだった。useEffectは
  // レンダー後に走るため、識別が変わった最初のレンダーには間に合わず、
  // 前の識別のキャッシュのまま一度描画されてしまう（Rレビュー指摘）。
  // 正しさは各問い合わせのqueryKeyにviewerKeyを含めることで担保する
  // （apps/app/lib/viewer-key.ts）。ここで毎回クリアしているのは
  // 純粋に容量のため——識別を切り替えるたびに前の識別のキャッシュ枠が
  // ヒープに残り続けるのを防ぐ。無くても正しさは壊れない
  const identity = isAuthenticated ? "auth" : isDemoViewer ? "guest" : "anon";
  const previousIdentityRef = useRef(identity);
  useEffect(() => {
    if (previousIdentityRef.current !== identity) {
      queryClient.clear();
      previousIdentityRef.current = identity;
    }
  }, [identity]);

  if (isSessionPending || ((isAuthenticated || isDemoViewer) && isCoupleLoading)) {
    // 通常は一瞬で終わるためスピナーを出すほどではないが、何も表示しないと
    // 遅延時に画面が固まって見える（security-auditor全体監査・3状態レビュー指摘）
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text color="muted">読み込み中…</Text>
        </View>
      </Screen>
    );
  }

  // 認証済み利用者がcouple.getでNEEDS_ONBOARDING以外のエラー（通信断等）を
  // 受けると、hasCouple・needsOnboarding・showAuthのどれもtrueにならない
  // （resolveRootRouteのコメント参照）。retry:falseのためreact-queryの
  // 自動再試行も無く、このままでは再読み込みでしか戻れない空白画面のまま
  // 止まる（実際に踏んだ不具合。security-auditor全体監査・3状態レビュー指摘で
  // 発覚）。ゲストの失敗はdemoFailedが別に受け止めるため、ここに来るのは
  // 認証済み利用者だけ
  if (!hasCouple && !needsOnboarding && !showAuth) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }}>
          <Text color="muted">読み込めませんでした</Text>
          <Button
            onPress={async () => {
              await refetchCouple();
            }}
          >
            再試行
          </Button>
        </View>
      </Screen>
    );
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
            受けると、hasCouple・needsOnboarding・showAuthのどれもtrueにならない。
            ゲストの失敗はここに含まれない。showAuthのdemoFailedが別に
            受け止め、サインイン画面へ理由付きで戻す（architecture.md 3節）。
            【016で訂正】ここは元々「再試行でじきに解消する一瞬」と説明していたが、
            couple.getのuseQueryは`retry: false`のためreact-query側の自動再試行は
            無く、実際には利用者が手動で再読み込みするまで空白画面のまま止まる
            （Rレビュー全体監査R-3指摘。実際に踏んだ不具合）。上のガードが
            全てfalseになるこの状態は、このコンポーネントの先頭で
            再試行UI（refetchCouple）を出す分岐として拾っている */}
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

import { useEffect, useState } from "react";
import { isDefinedError } from "@orpc/client";
import { Button, colors, Screen, Text, space } from "@futary/ui";
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
  const coupleQuery = useQuery({
    ...orpc.couple.get.queryOptions(),
    queryKey: [...orpc.couple.get.queryOptions().queryKey, viewerKey],
    enabled: isAuthenticated || isDemoViewer,
    retry: false,
  });
  const { data: couple, error: coupleError, isLoading: isCoupleLoading, refetch: refetchCouple } = coupleQuery;

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

  // 【発見: ゲストではじめる→/composeに飛んで読み込み中のまま止まる不具合の真因】
  // 以前はここで識別変化のたびに`queryClient.clear()`を呼んでいた
  // （016でA決定・訂正時点では「正しさの担保ではなく容量のため」と位置づけ、
  // 無くても正しさは壊れないはずだった）。しかし実測すると、識別が変わった
  // 直後・couple.getが新しいviewerKeyで発火した直後にこの`clear()`が走ると、
  // 発火したばかりの問い合わせがキャッシュごと消され、`retry:false`のため
  // 二度と再試行されずに`fetchStatus:"fetching"`のまま永久に止まっていた
  // （ローカルで`queryClient.getQueryCache().getAll()`が空であることまで
  // 実測して確認した）。正しさは各問い合わせのqueryKeyにviewerKeyを含める
  // ことで既に担保されているため（apps/app/lib/viewer-key.ts）、この
  // `clear()`は無くても正しさは壊れない。容量のための最適化のつもりが
  // 実害のあるバグを生んでいたため、削除した

  // isSessionPendingはアプリ起動直後の一度だけtrue（このときはまだStackを
  // 一度も出していないので、早期returnで置き換えても失うものが無い）。
  //
  // 一方、識別を切り替えた直後のisCoupleLoadingはStackが既にサインイン画面等を
  // 表示済みの状態で一瞬trueになる。以前はここも早期returnで<Stack>そのものを
  // 消して<Screen>に差し替えていたが、識別変化のたびにナビゲータ全体を
  // 作り直す形は壊れやすい（実際に「ゲストではじめる→/composeに飛んで
  // 読み込み中のまま止まる」不具合を調査した際、この早期returnが原因の
  // 候補として疑われた。実測では真因は別にあった——後述の`queryClient.clear()`
  // ——が、識別変化のたびにStackを消したり戻したりする構造自体が不要な
  // リスクであることに変わりはないため、Stackは常にマウントしたままにし、
  // ローディング・「読み込めませんでした」はオーバーレイとして重ねる形に
  // 直した（Stack.Protectedの3つのguardが全部falseになる一瞬はStackの
  // 中身が空になるだけで、Stackそのものは消えない）
  if (isSessionPending) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text color="muted">読み込み中…</Text>
        </View>
      </Screen>
    );
  }

  const isTransitionLoading = (isAuthenticated || isDemoViewer) && isCoupleLoading;

  // 認証済み利用者がcouple.getでNEEDS_ONBOARDING以外のエラー（通信断等）を
  // 受けると、hasCouple・needsOnboarding・showAuthのどれもtrueにならない
  // （resolveRootRouteのコメント参照）。retry:falseのためreact-queryの
  // 自動再試行も無く、このままでは再読み込みでしか戻れない空白画面のまま
  // 止まる（実際に踏んだ不具合。security-auditor全体監査・3状態レビュー指摘で
  // 発覚）。ゲストの失敗はdemoFailedが別に受け止めるため、ここに来るのは
  // 認証済み利用者だけ
  const isUnresolved = !isTransitionLoading && !hasCouple && !needsOnboarding && !showAuth;

  return (
    <GuestModeContext.Provider
      value={{
        isGuestMode: isDemoViewer,
        // 押した時点のURLは"/sign-in"のまま変わらないが、明示的にnavigateしなくても
        // guardがhasCouple:trueへ切り替わればStack.Protectedがその配下（(tabs)グループ）の
        // 既定画面へ自然に導く（実測で確認済み。Stackを常にマウントしたままにして
        // いるため。下のStackコメント参照）。明示的なnavigateを増やすほど
        // expo-routerの内部状態とURLの整合を自分で管理する箇所が増えるため、
        // 自然に導かれる形に任せられるならそちらを選ぶ
        enterGuestMode: () => {
          setDemoUnavailable(false);
          setIsGuestMode(true);
        },
        // 上と同じ理由。(auth)グループの中身は"sign-in"1つだけなので、
        // guardがshowAuth:trueへ切り替われば自然にそこへ着地する
        exitGuestMode: () => {
          setIsGuestMode(false);
        },
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
            全てfalseになるこの状態は、下のisUnresolvedオーバーレイが拾っている */}
      </Stack>
      {/* Stack自体は常にマウントしたまま、ローディング・未解決の状態は
          オーバーレイとして重ねる（上のコメント参照。Stackを条件分岐で
          消すとexpo-routerのナビゲータが再生成され、URLとの整合を失う） */}
      {isTransitionLoading && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text color="muted">読み込み中…</Text>
        </View>
      )}
      {isUnresolved && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.bg,
            alignItems: "center",
            justifyContent: "center",
            gap: space.md,
            padding: space.xl,
          }}
        >
          <Text color="muted">読み込めませんでした</Text>
          <Button
            onPress={async () => {
              await refetchCouple();
            }}
          >
            再試行
          </Button>
        </View>
      )}
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

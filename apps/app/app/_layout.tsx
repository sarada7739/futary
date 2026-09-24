import { useEffect, useState } from "react";
import { isDefinedError } from "@orpc/client";
import { AppearanceProvider, Button, Screen, space, Text, useTheme } from "@futary/ui";
import { Text as RNText, View } from "react-native";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { DemoBanner } from "../components/demo-banner";
import { useSession } from "../lib/auth-client";
import { isDemoEntry, isInFrame, leaveFrameToApp } from "../lib/demo-frame";
import { GuestModeContext } from "../lib/guest-mode";
import { orpc } from "../lib/orpc";
import { queryClient } from "../lib/query";
import { resolveRootRoute } from "../lib/root-route";
import { useViewerQueryKeyFrom } from "../lib/viewer-key";

function RootNavigator() {
  const { colors } = useTheme();
  const { data: session, isPending: isSessionPending } = useSession();
  // LP のスマホの枠（iframe）の中では認証済みとして扱わない（二重の守り。本体は lib/demo-frame.ts が
  // Cookie を送らないこと）。万一セッションが見えても、枠の中は実ユーザーの画面にしない（056）
  const inFrame = isInFrame();
  const isAuthenticated = !!session && !inFrame;
  // 未認証のデモ閲覧（「ゲストではじめる」・LP の枠の `/app/?demo=1`）。認証済みなら意味を持たない
  const [isGuestMode, setIsGuestMode] = useState(() => isDemoEntry());
  // デモの解決に失敗してサインイン画面へ戻された直後だけ true（理由を 1 行出す。architecture.md 3節）。
  // 次に「ゲストではじめる」を押したら消す
  const [demoUnavailable, setDemoUnavailable] = useState(false);
  const isDemoViewer = !isAuthenticated && isGuestMode;

  // couple.get は未所属なら NEEDS_ONBOARDING を投げる（architecture.md 5節）。未認証・非デモでは呼ばない。
  // queryKey に viewerKey を含める: couple.get は coupleId を引数に取らないので、キーだけでは誰が呼んだか
  // 区別できず、ログイン⇄ゲスト⇄未認証を切り替えると直前の別人のキャッシュが一瞬出る（共有端末では
  // 情報漏洩。security-requirements.md T9）。effect での clear() は最初のレンダーに間に合わないので、
  // 識別をキーに含めて他人のキャッシュを読む経路自体を無くす
  const viewerKey = useViewerQueryKeyFrom(isDemoViewer);
  const coupleQuery = useQuery({
    ...orpc.couple.get.queryOptions(),
    queryKey: [...orpc.couple.get.queryOptions().queryKey, viewerKey],
    enabled: isAuthenticated || isDemoViewer,
    retry: false,
  });
  const { data: couple, error: coupleError, isLoading: isCoupleLoading, refetch: refetchCouple } = coupleQuery;

  // 判定は lib/root-route.ts の純関数。デモ閲覧中に couple.get が失敗すると 3 つの guard がどれも true に
  // ならず空白になるので、demoFailed が拾ってサインイン画面へ落とす
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


  // 識別が変わったときに queryClient.clear() を呼ばない。新しい viewerKey で発火した直後の問い合わせを
  // キャッシュごと消し、retry:false なので fetching のまま止まる（ゲストではじめる → 読み込み中で止まる）。
  // 正しさは queryKey の viewerKey が担保している（lib/viewer-key.ts）

  // isSessionPending は起動直後の一度だけ true（まだ Stack を出していないので早期 return でよい）。
  // 識別を切り替えた直後の読み込みでは Stack を消さない（ナビゲータを作り直す形は壊れやすい）。
  // Stack は常にマウントしたままにし、読み込み中・「読み込めませんでした」はオーバーレイで重ねる
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

  // 認証済みで couple.get が NEEDS_ONBOARDING 以外のエラー（通信断等）だと、どの guard も true にならず、
  // retry:false なので再読み込みでしか戻れない空白で止まる。ゲストの失敗は demoFailed が受けるので、
  // ここに来るのは認証済みだけ
  const isUnresolved = !isTransitionLoading && !hasCouple && !needsOnboarding && !showAuth;

  return (
    <GuestModeContext.Provider
      value={{
        isGuestMode: isDemoViewer,
        // 明示的に navigate しなくても、guard が hasCouple:true に変われば Stack.Protected が既定画面
        // （(tabs)。compose ではない）へ導く。着地先はブラウザの URL でなく expo-router の内部状態と
        // guard の中の宣言順で決まる（URL だけ /app/compose にしてから押しても毎回 (tabs) だった）。
        // Stack を常にマウントしていることが前提。navigate を足すほど URL と内部状態の整合を自分で持つことになる
        enterGuestMode: () => {
          setDemoUnavailable(false);
          setIsGuestMode(true);
        },
        // 上と同じ理由（(auth) の中身は sign-in 1 つだけ）。
        // LP の枠の中では、サインイン画面の代わりに親ページを /app/ に飛ばす。飛ばすのは利用者の操作のとき
        // だけで、デモの読み込みの失敗（demoFailed）では飛ばさない（何も押していないのに LP ごと飛ぶ。056）
        exitGuestMode: () => {
          setIsGuestMode(false);
          if (inFrame) leaveFrameToApp();
        },
        demoUnavailable,
      }}
    >
      {isDemoViewer && <DemoBanner />}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={hasCouple}>
          {/* compose より先に置く。宣言順が着地先を決める（上の enterGuestMode のコメント）。
              入れ替えるとゲストは投稿モーダルに着地する */}
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="compose"
            options={{ presentation: "modal", headerShown: true, title: "投稿する" }}
          />
        </Stack.Protected>
        <Stack.Protected guard={needsOnboarding}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        {/* 枠の中ではサインイン画面（Google のボタン・「ゲストではじめる」）を出さない。その状態は下の 1 行の画面が受ける */}
        <Stack.Protected guard={showAuth && !inFrame}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* 認証済みで couple.get が NEEDS_ONBOARDING 以外のエラーだと、どの guard も true にならない
            （retry:false なので空白のまま止まる）。この状態は下の isUnresolved のオーバーレイが拾う。
            ゲストの失敗は showAuth の demoFailed がサインイン画面へ理由付きで戻す（architecture.md 3節） */}
      </Stack>
      {/* Stack は常にマウントしたまま、読み込み中・未解決はオーバーレイで重ねる
          （条件で消すとナビゲータが作り直され、URL との整合を失う） */}
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
      {/* 枠の中で未認証・ゲストでもない状態（demoFailed のあと・exitGuestMode の直後の一瞬）は
          「デモを読み込めませんでした」+「アプリを開く」（親ページで /app/ を開く）だけ */}
      {showAuth && inFrame && (
        <View
          testID="frame-fallback"
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
          <Text color="muted">デモを読み込めませんでした</Text>
          <RNText
            accessibilityRole="link"
            testID="frame-fallback-open"
            style={{ color: colors.brandInk, fontWeight: "700" }}
            {...({ href: "/app/", hrefAttrs: { target: "_top" } } as object)}
          >
            アプリを開く
          </RNText>
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
    // 外観の Provider はルートに 1 つ。保存値を同期で読むので、最初のレンダーから選んだ外観で描ける（039）
    <AppearanceProvider>
      <QueryClientProvider client={queryClient}>
        <RootNavigator />
      </QueryClientProvider>
    </AppearanceProvider>
  );
}

import { Button, Card, iconPanelWant, iconReleases, Screen, space, Text, useTheme } from "@futary/ui";
import type { BillingInterval } from "@futary/contract";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, ScrollView, View } from "react-native";
import { LegalLinks } from "../../components/legal-links";
import { useGuestMode } from "../../lib/guest-mode";
import { orpc } from "../../lib/orpc";
import { paidPhotoLimitLabel, paidPlanLabel, priceLabel } from "../../lib/plan";
import { queryClient } from "../../lib/query";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

// プレミアムの画面（045・048）。上に絵（ピンクはハート、ホワイトは ✦。どちらも primary で塗る）・題・
// 「できること」のカード（「写真 50 万枚まで」「アルバムはいくつでも」の 2 行だけ）・月額／年額の切り替えと
// 価格（billing.prices。直書きしない）・「プレミアムを始める →」（Checkout の url へ）・下に特商法と利用規約。
// paid なら「プレミアムです」と「プランを管理」（stripe の行のときだけ）。ゲストは価格を見られ、ボタンは
// 「ログインして始める」。「無料トライアル」「無制限」は出さない。
// 戻る: 3 箇所から来るので固定できず、ここだけ router.back()（履歴が無ければ /album）。
//
// ?status=success で戻ったら「反映しています…」を出し、couple.get を 3 秒ごとに読み直す（最大 30 秒。
// Webhook は遅れることがある）

// 絵の大きさ
const PICTURE_SIZE = 56;
const CONFIRM_INTERVAL_MS = 3000;
const CONFIRM_TIMEOUT_MS = 30_000;

function HeaderTextButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={space.sm}
      testID={testID}
      style={{ paddingHorizontal: space.md }}
    >
      <Text color="brand">{label}</Text>
    </Pressable>
  );
}

// Checkout・Portal は Stripe のページ。同じタブで移動する（戻り先は success_url・return_url）
function goToExternal(url: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") window.location.assign(url);
}

export default function PremiumScreen() {
  const { appearance, colors } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { isGuestMode, exitGuestMode } = useGuestMode();
  const params = useLocalSearchParams<{ status?: string | string[] }>();
  const returnedFromCheckout = (Array.isArray(params.status) ? params.status[0] : params.status) === "success";
  const viewerKey = useViewerQueryKey();

  const [interval, setInterval_] = useState<BillingInterval>("month");
  // Checkout から戻った直後の「反映しています…」。paid を見たら done、30 秒で timeout
  const [confirm, setConfirm] = useState<"idle" | "waiting" | "done" | "timeout">(returnedFromCheckout ? "waiting" : "idle");
  const confirmStartedAt = useRef(Date.now());

  // 価格は誰でも同じだが、キーは他と同じく viewerKey を含める（免除を増やさない。T9）
  const pricesOptions = orpc.billing.prices.queryOptions({ input: {} });
  const pricesQuery = useQuery({ ...pricesOptions, queryKey: [...pricesOptions.queryKey, viewerKey] });
  const coupleQuery = useQuery({
    ...orpc.couple.get.queryOptions(),
    queryKey: [...orpc.couple.get.queryOptions().queryKey, viewerKey],
    // 反映待ちの間だけ 3 秒ごとに読み直す
    refetchInterval: confirm === "waiting" ? CONFIRM_INTERVAL_MS : false,
  });
  const plan = coupleQuery.data?.plan ?? null;
  const planSource = coupleQuery.data?.planSource ?? null;
  // ゲスト（デモペア）は paid で返るが、申し込みの対象ではない
  const isPaid = !isGuestMode && plan === "paid";

  useEffect(() => {
    if (confirm !== "waiting") return;
    if (isPaid) {
      setConfirm("done");
      void queryClient.invalidateQueries({ queryKey: orpc.couple.get.key() });
      return;
    }
    if (Date.now() - confirmStartedAt.current >= CONFIRM_TIMEOUT_MS) setConfirm("timeout");
  }, [confirm, isPaid, coupleQuery.dataUpdatedAt]);

  const checkout = useMutation(
    orpc.billing.createCheckoutSession.mutationOptions({
      onSuccess: ({ url }) => goToExternal(url),
    }),
  );
  const portal = useMutation(
    orpc.billing.createPortalSession.mutationOptions({
      onSuccess: ({ url }) => goToExternal(url),
    }),
  );

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <HeaderTextButton
          label="‹ 戻る"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.push("/album");
          }}
          testID="premium-back"
        />
      ),
    });
    // router は毎回同じ振る舞い。依存に入れると setOptions が描画のたびに走る
  }, [navigation]);

  const prices = pricesQuery.data;
  const selectedPrice = prices ? (interval === "month" ? prices.monthly : prices.yearly) : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.md }}>
        <View style={{ alignItems: "center", gap: space.sm, paddingVertical: space.md }}>
          <Image
            testID={appearance === "white" ? "premium-picture-sparkle" : "premium-picture-heart"}
            source={appearance === "white" ? iconReleases : iconPanelWant}
            style={{ width: PICTURE_SIZE, height: PICTURE_SIZE, tintColor: colors.primary }}
            resizeMode="contain"
          />
          <Text size="xl" weight="bold" align="center" testID="premium-title">
            プレミアムプラン
          </Text>
          <Text color="muted" align="center">
            大切な思い出を、もっと自由に。
          </Text>
        </View>

        {confirm === "waiting" && (
          <Card testID="premium-confirming">
            <Text align="center">反映しています…</Text>
          </Card>
        )}
        {confirm === "done" && (
          <Card accent testID="premium-confirmed">
            <Text align="center" weight="bold">
              プレミアムになりました
            </Text>
          </Card>
        )}
        {confirm === "timeout" && (
          <Card testID="premium-confirm-timeout">
            <Text align="center" color="muted">
              少し時間がかかることがあります。マイページで確かめてください
            </Text>
          </Card>
        )}

        <Card accent testID="premium-features">
          <View style={{ gap: space.sm }}>
            <Text weight="bold">できること</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text color="brand" weight="bold">
                ✓
              </Text>
              <Text>{paidPhotoLimitLabel()}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text color="brand" weight="bold">
                ✓
              </Text>
              <Text>アルバムはいくつでも</Text>
            </View>
          </View>
        </Card>

        {isPaid ? (
          <Card testID="premium-current">
            <View style={{ gap: space.md }}>
              <Text weight="bold" align="center">
                プレミアムです
              </Text>
              {/* 期間の終わりで解約済みなら「10月15日まで」（更新されない）。それ以外は何も出さない */}
              {coupleQuery.data?.planCancelAt != null && (
                <Text size="sm" color="muted" align="center" testID="premium-cancel-at">
                  {paidPlanLabel(null, coupleQuery.data.planCancelAt)}
                </Text>
              )}
              {planSource === "stripe" && (
                <Button
                  variant="secondary"
                  onPress={() => portal.mutate({})}
                  disabled={portal.isPending}
                  testID="premium-manage"
                >
                  プランを管理
                </Button>
              )}
              {portal.isError && (
                <Text size="sm" color="muted" align="center">
                  開けませんでした。しばらくしてからお試しください
                </Text>
              )}
            </View>
          </Card>
        ) : (
          <Card testID="premium-checkout">
            <View style={{ gap: space.md }}>
              {/* 月額／年額の切り替え。選んでいる方を primary の丸で */}
              <View style={{ flexDirection: "row", gap: space.sm }}>
                {(["month", "year"] as const).map((value) => {
                  const selected = interval === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setInterval_(value)}
                      testID={`premium-interval-${value}`}
                      style={{
                        flex: 1,
                        alignItems: "center",
                        paddingVertical: space.sm,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primary : "transparent",
                      }}
                    >
                      <Text weight="bold" color={selected ? "inverse" : "default"}>
                        {value === "month" ? "月額" : "年額"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text size="xl" weight="bold" align="center" testID="premium-price">
                {selectedPrice ? priceLabel(selectedPrice, interval) : pricesQuery.isError ? "価格を読み込めませんでした" : "…"}
              </Text>

              {isGuestMode ? (
                <Button onPress={exitGuestMode} testID="premium-login">
                  ログインして始める
                </Button>
              ) : (
                <Button
                  onPress={() => checkout.mutate({ interval })}
                  disabled={checkout.isPending || !selectedPrice}
                  testID="premium-start"
                >
                  プレミアムを始める →
                </Button>
              )}
              {checkout.isError && (
                <Text size="sm" color="muted" align="center" testID="premium-checkout-error">
                  {checkout.error && "code" in checkout.error && checkout.error.code === "CONFLICT"
                    ? "すでにプレミアムです"
                    : "始められませんでした。しばらくしてからお試しください"}
                </Text>
              )}
              <Text size="sm" color="muted" align="center">
                いつでも解約できます・自動更新
              </Text>
            </View>
          </Card>
        )}

        <LegalLinks pages={["/tokushoho", "/terms"]} />
      </ScrollView>
    </Screen>
  );
}

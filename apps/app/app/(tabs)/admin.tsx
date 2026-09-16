import { useEffect, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { ADMIN_STAT_KEYS, type AdminCount, type AdminLookup, type AdminStatKey, type Plan } from "@futary/contract";
import { formatJstDate, formatJstDateTime } from "@futary/date";
import { Button, Card, type Colors, radius, Screen, space, Text, useTheme } from "@futary/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigation, useRouter } from "expo-router";
import { Sheet } from "../../components/sheet";
import { useGuestMode } from "../../lib/guest-mode";
import { orpc } from "../../lib/orpc";
import { queryClient } from "../../lib/query";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

// 057: 運営の画面（docs/tasks/057-admin.md 2節）。/app/admin（タブに出さない。マイページの「運営 ›」から）。
// 上から: 見出し + 運営のメール / 全体の数（5 つ）/ メールで探す → 利用者の箱とペアの箱 + 切り替え /
// 直近の操作。線: 出すのは数とプランの行だけ（名前・本文・写真は API が返さない）。
// 運営以外は admin.* が FORBIDDEN なので、画面は「見られません」の 1 行

const STAT_LABELS: Record<AdminStatKey, string> = {
  couples: "ペア",
  users: "利用者",
  paidCouples: "プレミアム",
  posts: "投稿",
  images: "画像",
};

function inputStyleOf(colors: Colors) {
  return {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    padding: space.md,
    fontSize: 16,
    color: colors.text,
  } as const;
}

function StatCard({ label, count, testID }: { label: string; count: AdminCount; testID: string }) {
  return (
    <Card testID={testID}>
      <View style={{ gap: 2 }}>
        <Text size="xs" color="muted">
          {label}
        </Text>
        <Text size="lg" weight="bold">
          {count.total.toLocaleString("ja-JP")}
        </Text>
        <Text size="xs" color="muted">
          {`今日 +${count.today}・7 日平均 +${count.avg7d.toFixed(1)}/日`}
        </Text>
      </View>
    </Card>
  );
}

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
      <Text size="sm" color="muted">
        {label}
      </Text>
      <Text size="sm" testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function planLabelOf(plan: Plan): string {
  return plan === "paid" ? "プレミアム" : "無料";
}

// 記録の detail（JSON: 前後のプラン）を「無料 → プレミアム」に。読めなければそのまま
function detailLabel(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { from?: { plan?: string } | null; to?: { plan?: string } };
    const from = parsed.from?.plan;
    const to = parsed.to?.plan;
    if (to !== "paid" && to !== "free") return detail;
    return `${from === "paid" || from === "free" ? planLabelOf(from) : "（行なし）"} → ${planLabelOf(to)}`;
  } catch {
    return detail;
  }
}

export default function AdminScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { isGuestMode } = useGuestMode();
  const viewerKey = useViewerQueryKey();

  const meOptions = orpc.me.get.queryOptions();
  const meQuery = useQuery({ ...meOptions, queryKey: [...meOptions.queryKey, viewerKey], enabled: !isGuestMode });
  const coupleOptions = orpc.couple.get.queryOptions();
  const coupleQuery = useQuery({ ...coupleOptions, queryKey: [...coupleOptions.queryKey, viewerKey], enabled: !isGuestMode });
  const isAdmin = coupleQuery.data?.isAdmin === true;

  const statsOptions = orpc.admin.stats.queryOptions({ input: {} });
  const statsQuery = useQuery({ ...statsOptions, queryKey: [...statsOptions.queryKey, viewerKey], enabled: isAdmin });
  const actionsOptions = orpc.admin.actions.queryOptions({ input: {} });
  const actionsQuery = useQuery({ ...actionsOptions, queryKey: [...actionsOptions.queryKey, viewerKey], enabled: isAdmin });

  const [email, setEmail] = useState("");
  const [lookup, setLookup] = useState<{ email: string; result: AdminLookup } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 切り替えの確認（null なら閉じている）
  const [confirming, setConfirming] = useState<Plan | null>(null);

  const lookupMutation = useMutation(orpc.admin.lookup.mutationOptions());
  const setPlan = useMutation(
    orpc.admin.setPlan.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.admin.actions.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.admin.stats.key() }),
        ]);
      },
    }),
  );

  useEffect(() => {
    navigation.setOptions({ title: "運営" });
  }, [navigation]);

  async function handleLookup() {
    const trimmed = email.trim();
    if (trimmed.length === 0 || lookupMutation.isPending) return;
    setNotice(null);
    try {
      const result = await lookupMutation.mutateAsync({ email: trimmed });
      setLookup({ email: trimmed, result });
    } catch {
      setNotice("探せませんでした。もう一度お試しください");
    }
  }

  async function handleSetPlan() {
    if (!lookup?.result.couple || confirming === null) return;
    const plan = confirming;
    setConfirming(null);
    setNotice(null);
    try {
      await setPlan.mutateAsync({ coupleId: lookup.result.couple.id, plan });
      // 探し直して今の行を出す
      const result = await lookupMutation.mutateAsync({ email: lookup.email });
      setLookup({ email: lookup.email, result });
      setNotice(plan === "paid" ? "プレミアムにしました" : "無料に戻しました");
    } catch {
      setNotice("変更できませんでした。Stripe のペアは Stripe で管理してください");
    }
  }

  if (isGuestMode || (coupleQuery.data && !isAdmin)) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.md }}>
          <Text color="muted" testID="admin-forbidden">
            この画面は見られません
          </Text>
          <Button variant="secondary" onPress={() => router.push("/profile")}>
            マイページへ
          </Button>
        </View>
      </Screen>
    );
  }

  const couple = lookup?.result.couple ?? null;
  const user = lookup?.result.user ?? null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <Text size="lg" weight="bold" testID="admin-title">
            運営
          </Text>
          <Text size="sm" color="muted" testID="admin-email">
            {meQuery.data?.email ?? ""}
          </Text>
        </View>

        {/* 全体の数（1 分キャッシュ。デモを除く） */}
        <View style={{ gap: space.sm }}>
          <Text weight="bold">全体の数</Text>
          {statsQuery.data ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {ADMIN_STAT_KEYS.map((key) => (
                <View key={key} style={{ flexBasis: "47%", flexGrow: 1 }}>
                  <StatCard label={STAT_LABELS[key]} count={statsQuery.data[key]} testID={`admin-stat-${key}`} />
                </View>
              ))}
            </View>
          ) : (
            <Text color="muted">{statsQuery.isError ? "読み込めませんでした" : "読み込み中…"}</Text>
          )}
        </View>

        {/* メールで探す */}
        <View style={{ gap: space.sm }}>
          <Text weight="bold">メールで探す</Text>
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <TextInput
              testID="admin-lookup-email"
              value={email}
              onChangeText={setEmail}
              placeholder="メールアドレス（完全一致）"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onSubmitEditing={handleLookup}
              style={inputStyleOf(colors)}
            />
            <Button onPress={handleLookup} disabled={email.trim().length === 0 || lookupMutation.isPending} testID="admin-lookup-submit">
              探す
            </Button>
          </View>
          {notice && (
            <Text size="sm" color="muted" testID="admin-notice">
              {notice}
            </Text>
          )}
          {lookup && !user && (
            <Text color="muted" testID="admin-lookup-none">
              見つかりません
            </Text>
          )}
          {user && (
            <Card testID="admin-lookup-user">
              <View style={{ gap: space.xs }}>
                <Text weight="bold">利用者</Text>
                <Row label="メール" value={user.email} />
                <Row label="登録日" value={formatJstDate(user.createdAt)} />
                <Row label="投稿" value={`${user.posts} 件`} />
                <Row label="投稿の写真" value={`${user.postImages} 枚`} />
              </View>
            </Card>
          )}
          {user && (
            <Card testID="admin-lookup-couple">
              <View style={{ gap: space.xs }}>
                <Text weight="bold">ペア</Text>
                {couple ? (
                  <>
                    <Row label="作成日" value={formatJstDate(couple.createdAt)} />
                    <Row label="人数" value={`${couple.members} 人`} />
                    <Row label="プラン" value={planLabelOf(couple.plan)} testID="admin-couple-plan" />
                    <Row label="出どころ" value={couple.source ?? "行なし"} testID="admin-couple-source" />
                    <Row label="期限" value={couple.expiresAt === null ? "無期限" : formatJstDate(couple.expiresAt)} />
                    <Row label="Stripe の customer" value={couple.hasStripeCustomer ? "あり" : "なし"} />
                    <Row label="投稿" value={`${couple.posts} 件`} />
                    <Row label="画像" value={`${couple.images} 枚`} />
                    <Row label="アルバム" value={`${couple.albums} 件`} />
                    <View style={{ marginTop: space.sm }}>
                      {couple.source === "stripe" ? (
                        <Text size="sm" color="muted" testID="admin-couple-stripe">
                          Stripe で管理（Portal）
                        </Text>
                      ) : couple.plan === "paid" ? (
                        <Button variant="secondary" onPress={() => setConfirming("free")} disabled={setPlan.isPending} testID="admin-set-free">
                          無料に戻す
                        </Button>
                      ) : (
                        <Button onPress={() => setConfirming("paid")} disabled={setPlan.isPending} testID="admin-set-paid">
                          プレミアムにする
                        </Button>
                      )}
                    </View>
                  </>
                ) : (
                  <Text size="sm" color="muted" testID="admin-couple-none">
                    ペアに所属していません
                  </Text>
                )}
              </View>
            </Card>
          )}
        </View>

        {/* 直近の操作 */}
        <View style={{ gap: space.sm }}>
          <Text weight="bold">直近の操作</Text>
          {actionsQuery.data ? (
            actionsQuery.data.items.length === 0 ? (
              <Text color="muted" testID="admin-actions-empty">
                まだありません
              </Text>
            ) : (
              <Card>
                <View style={{ gap: space.sm }}>
                  {actionsQuery.data.items.map((item) => (
                    <View key={item.id} testID={`admin-action-${item.id}`} style={{ gap: 2 }}>
                      <Text size="xs" color="muted">
                        {`${formatJstDateTime(item.createdAt)}・${item.adminEmail ?? "（退会）"}`}
                      </Text>
                      <Text size="sm">{`${item.action}・${item.coupleId.slice(0, 8)}・${detailLabel(item.detail)}`}</Text>
                    </View>
                  ))}
                </View>
              </Card>
            )
          ) : (
            <Text color="muted">{actionsQuery.isError ? "読み込めませんでした" : "読み込み中…"}</Text>
          )}
        </View>
      </ScrollView>

      {/* 切り替えの確認（戻せるので danger は当てない） */}
      <Sheet visible={confirming !== null} onClose={() => setConfirming(null)} title="プランの切り替え">
        <View style={{ gap: space.md }}>
          <Text testID="admin-confirm-text">
            {confirming === "paid"
              ? `${lookup?.email ?? ""}のペアをプレミアムにします`
              : `${lookup?.email ?? ""}のペアを無料に戻します`}
          </Text>
          <Button onPress={handleSetPlan} testID="admin-confirm">
            変更
          </Button>
          <Button variant="ghost" onPress={() => setConfirming(null)}>
            キャンセル
          </Button>
        </View>
      </Sheet>
    </Screen>
  );
}

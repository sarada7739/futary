import { Image, Pressable, View } from "react-native";
import type { AlbumQuota } from "@futary/contract";
import { Button, iconWarning, radius, space, Text, useTheme } from "@futary/ui";
import { paidPhotoLimitCtaLabel, quotaWarningBody, quotaWarningTitle } from "../lib/plan";

// 045: アルバム詳細の FAB の上に出す残りの警告（タスク定義 3節。絵 01）。free で残りが
// QUOTA_WARNING_THRESHOLD 枚以下のとき（呼び出し側が判断する）。
// ⚠「残り N 枚です」「あと N 枚で上限（無料プラン 30 枚）に達します」「プレミアムで 50 万枚まで」（→ /premium。047 0節 #14: 「無制限」と書かない）。
// 右上の × で消せる（人間の指示。2026-09-14）。消した状態の寿命は呼び出し側（lib/quota-warning-dismissed.ts）

// 数値は B が決めた: ⚠ は 24（96×96 の線画を tintColor で primary に）
const WARNING_ICON = 24;

export function QuotaWarningCard({
  quota,
  onPremium,
  onDismiss,
}: {
  quota: AlbumQuota;
  onPremium: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      testID="album-quota-warning"
      style={{
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.primary,
        backgroundColor: colors.primarySubtle,
        padding: space.md,
        gap: space.xs,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Image source={iconWarning} style={{ width: WARNING_ICON, height: WARNING_ICON, tintColor: colors.primary }} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <Text size="lg" weight="bold" color="brand" testID="album-quota-warning-title">
            {quotaWarningTitle(quota)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="警告を閉じる"
          onPress={onDismiss}
          hitSlop={space.sm}
          testID="album-quota-warning-close"
        >
          <Text size="lg" color="muted">
            ×
          </Text>
        </Pressable>
      </View>
      <Text size="sm" color="muted" testID="album-quota-warning-body">
        {quotaWarningBody(quota)}
      </Text>
      <View style={{ alignItems: "flex-start", marginTop: space.xs }}>
        <Button variant="secondary" onPress={onPremium} testID="album-quota-warning-premium">
          {paidPhotoLimitCtaLabel()}
        </Button>
      </View>
    </View>
  );
}

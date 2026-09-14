import { Image, View } from "react-native";
import type { AlbumQuota } from "@futary/contract";
import { Button, iconWarning, radius, space, Text, useTheme } from "@futary/ui";
import { quotaWarningBody, quotaWarningTitle } from "../lib/plan";

// 045: アルバム詳細の FAB の上に出す残りの警告（タスク定義 3節。絵 01）。free で残りが
// QUOTA_WARNING_THRESHOLD 枚以下のとき（呼び出し側が判断する）。
// ⚠「残り N 枚です」「あと N 枚で上限（無料プラン 30 枚）に達します」「プレミアムで無制限に」（→ /premium）

// 数値は B が決めた: ⚠ は 24（96×96 の線画を tintColor で primary に）
const WARNING_ICON = 24;

export function QuotaWarningCard({ quota, onPremium }: { quota: AlbumQuota; onPremium: () => void }) {
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
        <Text size="lg" weight="bold" color="brand" testID="album-quota-warning-title">
          {quotaWarningTitle(quota)}
        </Text>
      </View>
      <Text size="sm" color="muted" testID="album-quota-warning-body">
        {quotaWarningBody(quota)}
      </Text>
      <View style={{ alignItems: "flex-start", marginTop: space.xs }}>
        <Button variant="secondary" onPress={onPremium} testID="album-quota-warning-premium">
          プレミアムで無制限に
        </Button>
      </View>
    </View>
  );
}

import { Pressable, Text as RNText, View } from "react-native";
import type { AlbumQuota } from "@futary/contract";
import { Card, fontFamily, radius, space, Text, useTheme } from "@futary/ui";
import { albumQuotaCountLabel, albumQuotaRatio, albumQuotaRemainingLabel } from "../lib/plan";

// 045: アルバム一覧の「写真の使用量」のカード（タスク定義 3節。絵 05）。タイムラインのカードの下。
// バー（used / limit）・「27 / 30 枚」・「あと 3 枚」（上限なら「上限に達しています」）・
// 「プレミアムで無制限に ›」（→ /premium）。free のときだけ出す（呼び出し側が判断する）

// 数値は B が決めた: バーの高さ 10・枚数は Poppins 20 bold（数字の行）
const BAR_HEIGHT = 10;
const COUNT_FONT_SIZE = 20;

export function UsageCard({ quota, onPremium }: { quota: AlbumQuota; onPremium: () => void }) {
  const { colors } = useTheme();
  const ratio = albumQuotaRatio(quota);
  return (
    <Card testID="album-usage-card">
      <View style={{ gap: space.sm }}>
        <Text weight="bold">写真の使用量</Text>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: quota.limit, now: Math.min(quota.used, quota.limit) }}
          testID="album-usage-bar"
          style={{ height: BAR_HEIGHT, borderRadius: radius.pill, backgroundColor: colors.surfaceTint, overflow: "hidden" }}
        >
          <View
            testID="album-usage-bar-fill"
            style={{ width: `${Math.round(ratio * 100)}%`, height: "100%", borderRadius: radius.pill, backgroundColor: colors.primary }}
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: space.md }}>
          <RNText
            testID="album-usage-count"
            style={{ fontFamily: fontFamily.numeric, fontSize: COUNT_FONT_SIZE, lineHeight: 28, fontWeight: "700", color: colors.text }}
          >
            {albumQuotaCountLabel(quota)}
          </RNText>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="プレミアムで無制限に"
              onPress={onPremium}
              hitSlop={space.sm}
              testID="album-usage-premium"
            >
              <Text size="sm" weight="medium" color="brand">
                プレミアムで無制限に ›
              </Text>
            </Pressable>
            <Text size="xs" color="muted" testID="album-usage-remaining">
              {albumQuotaRemainingLabel(quota)}
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

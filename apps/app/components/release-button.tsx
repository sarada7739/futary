import { iconReleases, radius, space, Text, useTheme } from "@futary/ui";
import { Image, Pressable, View } from "react-native";
import { NewBadge } from "./new-badge";

// 043: ホームの 3×3 パネルの下、全幅 1 本の「リリース履歴を見る」（タスク定義 3節。見本 01・03）。
// 左に ✦（線画。primary で塗る）、中央に文言、右に ›。未読なら右上に NEW。
// 形は Button の secondary と同じ語彙（surface の地・primary の 1px 枠・押すと surfaceTint）。
// ピンクは枠がピンク、ホワイトは黒（色は部品に任せる。画面で appearance を読まない）。
// 数値は B が決めた: 高さ 52（パネルのカードより低く、タブバーのピルより少し低い）・角はピル・
// アイコン 20・NEW は右上に 8pt はみ出す
const BUTTON_HEIGHT = 52;
const ICON_SIZE = 20;
const BADGE_OVERHANG = 8;

export function ReleaseButton({ hasNew, onPress }: { hasNew: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    // NEW がはみ出す分、上に余白を取る（ScrollView の gap では上のパネルに重なる）
    <View style={{ marginTop: BADGE_OVERHANG }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="リリース履歴を見る"
        onPress={onPress}
        testID="release-button"
        style={({ pressed }) => ({
          height: BUTTON_HEIGHT,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.primary,
          backgroundColor: pressed ? colors.surfaceTint : colors.surface,
          paddingHorizontal: space.lg,
          flexDirection: "row",
          alignItems: "center",
        })}
      >
        <Image
          source={iconReleases}
          style={{ width: ICON_SIZE, height: ICON_SIZE, tintColor: colors.primary }}
          resizeMode="contain"
        />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text weight="medium">リリース履歴を見る</Text>
        </View>
        <Text color="brand" size="lg">
          ›
        </Text>
      </Pressable>
      {hasNew && (
        <View style={{ position: "absolute", top: -BADGE_OVERHANG, right: space.lg }} testID="release-button-new">
          <NewBadge />
        </View>
      )}
    </View>
  );
}

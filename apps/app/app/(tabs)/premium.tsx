import { Card, iconPanelWant, iconReleases, Screen, space, Text, useTheme } from "@futary/ui";
import { useNavigation, useRouter } from "expo-router";
import { useEffect } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";

// 045: プレミアムの画面（タスク定義 3節。絵 02。href: null）。一覧の使用量のカード・詳細の警告と
// 上限のシート・マイページの「プレミアムについて」から来る。
// 上に絵（ピンクはハートの線画 iconPanelWant、ホワイトは ✦ の線画 iconReleases。どちらも primary で塗る。
// 新しい絵は作らない）・「プレミアムプラン」・「大切な思い出を、もっと自由に。」・
// 「できること」のカード 1 枚（「写真枚数 無制限」の 1 行だけ。存在しない機能は書かない）・
// 「お申し込みは準備中です」の 1 行（ボタンではない）。月額／年額とカードは 048 で。
// 「無料トライアル」の文言はどこにも出さない（人間の指示）。
// 戻る: 3 箇所から来るので来た画面に固定できない。ここだけ router.back()。履歴が無ければ /album

// 数値は B が決めた: 絵は 56
const PICTURE_SIZE = 56;

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

export default function PremiumScreen() {
  const { appearance, colors } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();

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

        <Card accent testID="premium-features">
          <View style={{ gap: space.sm }}>
            <Text weight="bold">できること</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text color="brand" weight="bold">
                ✓
              </Text>
              <Text>写真枚数 無制限</Text>
            </View>
          </View>
        </Card>

        <Text size="sm" color="muted" align="center" testID="premium-coming-soon">
          お申し込みは準備中です
        </Text>
      </ScrollView>
    </Screen>
  );
}

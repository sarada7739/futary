import { Pressable, View } from "react-native";
import { colors, space, Text } from "@futary/ui";
import { SafeAreaView } from "react-native-safe-area-context";
import { useGuestMode } from "../lib/guest-mode";

// 未認証のデモ閲覧中、常時表示するバナー（docs/tasks/014-guest-demo.md）。
// ルートレイアウトに置き、どの画面へ移動しても消えない
// （architecture.md 7節「画面の外枠は常に出す」と同じ考え方）
export function DemoBanner() {
  const { exitGuestMode } = useGuestMode();

  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.brandInk }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
          gap: space.md,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text size="xs" color="inverse">
            これはデモです。ログインすると自分のふたりの記録を残せます
          </Text>
        </View>
        <Pressable onPress={exitGuestMode} accessibilityRole="button" testID="demo-banner-login">
          <Text size="xs" weight="bold" color="inverse">
            ログイン
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

import { Image, Pressable, Text as RNText, View } from "react-native";
import { colors, fontFamily, gradients, layout, space, sparkle } from "@futary/ui";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useGuestMode } from "../lib/guest-mode";

const ICON_SIZE = 14;

// 未認証のデモ閲覧中、常時表示するバナー（docs/tasks/014-guest-demo.md）。
// ルートレイアウトに置き、どの画面へ移動しても消えない
// （architecture.md 7節「画面の外枠は常に出す」と同じ考え方）。
// 035視覚仕様2節: ピル型に。上の濃い帯（brand-ink全幅）が画面最上部で
// 唯一の濃色ブロックとなり、視線が主役（記念日カード）より先にここへ
// 吸われていた（診断1）ため、淡い地に変える
export function DemoBanner() {
  const { exitGuestMode } = useGuestMode();

  return (
    <SafeAreaView edges={["top"]}>
      {/* デスクトップで全幅に伸ばさない。layout.maxWidthの列の中に収める
          （035視覚仕様2節。全幅の帯はデスクトップで最も悪く見える、という指摘） */}
      <View style={{ width: "100%", maxWidth: layout.maxWidth, alignSelf: "center" }}>
        <LinearGradient
          colors={gradients.card}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginHorizontal: 20,
            marginTop: 12,
            height: 36,
            paddingHorizontal: 14,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.primarySubtle,
            gap: space.sm,
          }}
        >
          <Image
            source={sparkle}
            style={{ width: ICON_SIZE, height: ICON_SIZE, tintColor: colors.primary }}
            resizeMode="contain"
          />
          <RNText
            style={{ fontFamily: fontFamily.ja, flex: 1, fontSize: 11, fontWeight: "400", color: colors.text }}
            numberOfLines={1}
          >
            これはデモです。ログインで記録を残せます
          </RNText>
          <Pressable onPress={exitGuestMode} accessibilityRole="button" testID="demo-banner-login">
            {/* 035書体仕様: ボタン相当の文字はweight600〜700・字間0.04em
                （11pt×0.04=0.44） */}
            <RNText
              style={{
                fontFamily: fontFamily.ja,
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 0.44,
                color: colors.primary,
              }}
            >
              ログイン
            </RNText>
          </Pressable>
        </LinearGradient>
      </View>
    </SafeAreaView>
  );
}

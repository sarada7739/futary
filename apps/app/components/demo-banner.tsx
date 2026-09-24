import { Image, Pressable, Text as RNText, View } from "react-native";
import { fontFamily, layout, space, sparkle, useTheme } from "@futary/ui";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useGuestMode } from "../lib/guest-mode";

const ICON_SIZE = 14;

// 未認証のデモ閲覧中に常に出すバナー（014）。ルートに置き、どの画面でも消えない（architecture.md 7節）。
// 淡い地のピル（濃い全幅の帯だと、視線が主役の記念日カードより先にここへ吸われる）
export function DemoBanner() {
  const { colors, gradients } = useTheme();
  const { exitGuestMode } = useGuestMode();

  return (
    <SafeAreaView edges={["top"]}>
      {/* デスクトップで全幅に伸ばさず、layout.maxWidth の列に収める */}
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
            {/* ボタン相当の文字は weight 600〜700・字間 0.04em（0.44） */}
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

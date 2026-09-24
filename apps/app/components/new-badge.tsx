import { fontFamily, radius, useTheme } from "@futary/ui";
import { Text as RNText, View } from "react-native";

// 「NEW」のピル（043）。地は primary（色は部品に任せる）、文字は surface。packages/ui の Badge は「会った日数」専用
// （半透明の白・高さ 28）なので使わない。高さ 20・横 10・英字なので Poppins 11pt・字間 0.5
const BADGE_HEIGHT = 20;

export function NewBadge({ label = "NEW", testID }: { label?: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        height: BADGE_HEIGHT,
        paddingHorizontal: 10,
        borderRadius: radius.pill,
        backgroundColor: colors.primary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <RNText
        style={{
          fontFamily: fontFamily.numeric,
          fontSize: 11,
          lineHeight: BADGE_HEIGHT,
          fontWeight: "700",
          letterSpacing: 0.5,
          color: colors.surface,
        }}
      >
        {label}
      </RNText>
    </View>
  );
}

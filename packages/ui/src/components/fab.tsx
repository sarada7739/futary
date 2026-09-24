import { Image, View } from "react-native";
import { iconFabPlus } from "../assets";
import { useTheme } from "../appearance";

export type FabIconProps = {
  size: number;
};

// 白い「＋」の腕の長さと太さ（size=56 で 22 と 2.5。ピンクの fab-plus.png の＋とほぼ同じ比率）
const PLUS_LENGTH_RATIO = 22 / 56;
const PLUS_THICKNESS_RATIO = 2.5 / 56;

// 中央の投稿ボタン（FAB）の絵。ピンクは画像（fab-plus.png: ピンクの円に白い＋）そのまま。
// ホワイトは黒い円（FAB は primary）。画像は円も＋も不透明で、tintColor を当てると＋まで塗りつぶされるので、
// View で描く。分岐はこの部品に閉じる（呼び出し側は appearance を読まない。039）
export function FabIcon({ size }: FabIconProps) {
  const { appearance, colors } = useTheme();

  if (appearance === "pink") {
    return <Image source={iconFabPlus} style={{ width: size, height: size }} resizeMode="contain" />;
  }

  const length = Math.round(size * PLUS_LENGTH_RATIO);
  const thickness = Math.max(2, Math.round(size * PLUS_THICKNESS_RATIO * 2) / 2);
  return (
    <View
      testID="fab-icon-white"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.primary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View style={{ position: "absolute", width: length, height: thickness, borderRadius: thickness / 2, backgroundColor: colors.surface }} />
      <View style={{ position: "absolute", width: thickness, height: length, borderRadius: thickness / 2, backgroundColor: colors.surface }} />
    </View>
  );
}

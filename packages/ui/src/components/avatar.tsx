import { Image, View } from "react-native";
import { useTheme } from "../appearance";
import { Text } from "./text";
import { initialOf } from "./avatar-logic";

export { initialOf } from "./avatar-logic";

export type AvatarProps = {
  name: string;
  imageUrl?: string;
  size?: number;
  // 光るリング。主役として見せる場所（記念日カード）だけが使う（小さく並ぶ場所で光ると煩雑）
  glow?: boolean;
};

// glow のときは縁（surface・3pt）を足し、一回り大きい光るハロー（primary-subtle の地・shadow.glow）で包む。
// 外径 86 は 80 + 3×2 から出す（値を 2 箇所に持たない）
const GLOW_RING_WIDTH = 3;

export function Avatar({ name, imageUrl, size = 40, glow = false }: AvatarProps) {
  const { colors, shadow } = useTheme();
  // overflow:"hidden"（丸く切り抜く）は影も切るので、影を持つ外側と切り抜く内側を分ける
  const circleStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: colors.primarySubtle,
    overflow: "hidden" as const,
    ...(glow ? { borderWidth: GLOW_RING_WIDTH, borderColor: colors.surface } : null),
  };

  // border はコンテンツ領域を内側に狭める（RN は border-box でない）ので、画像は固定 px でなく親の内側いっぱい
  // （100%）に敷く（border の有無で値が 2 つに増えない）
  const inner = imageUrl ? (
    <Image source={{ uri: imageUrl }} style={{ width: "100%", height: "100%" }} />
  ) : (
    <Text size="md" weight="bold" color="brand">
      {initialOf(name)}
    </Text>
  );

  if (!glow) {
    return <View style={circleStyle}>{inner}</View>;
  }

  const haloSize = size + GLOW_RING_WIDTH * 2;
  return (
    <View
      style={{
        width: haloSize,
        height: haloSize,
        borderRadius: haloSize / 2,
        backgroundColor: colors.primarySubtle,
        alignItems: "center",
        justifyContent: "center",
        ...shadow.glow,
      }}
    >
      <View style={circleStyle}>{inner}</View>
    </View>
  );
}

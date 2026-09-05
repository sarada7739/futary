import { Image, View } from "react-native";
import { colors, shadow } from "../tokens";
import { Text } from "./text";
import { initialOf } from "./avatar-logic";

export { initialOf } from "./avatar-logic";

export type AvatarProps = {
  name: string;
  imageUrl?: string;
  size?: number;
  // 光るリング（035）。主役として見せる場所（記念日カード）だけが使う。
  // 既定はfalse（一覧・マイページ等、小さく並ぶ場所で光ると煩雑になるため）
  glow?: boolean;
};

// 035: glow時は縁（surface・3pt）を足し、さらに一回り大きい光るハロー
// （primary-subtle地・shadow.glow）で包む（視覚仕様1節「外側86pt円・
// 画像80pt円・borderWidth3」。86=80+3*2で導出し、数値を2箇所に持たない）
const GLOW_RING_WIDTH = 3;

export function Avatar({ name, imageUrl, size = 40, glow = false }: AvatarProps) {
  // overflow:"hidden"（丸く切り抜くために必須）はshadowも一緒に切り取ってしまう
  // ため、光らせる場合は影を持つ外側のViewと、切り抜く内側のViewを分ける
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

  // borderWidth（glow時）はコンテンツ領域をその分だけ内側に狭める
  // （RNのボックスモデル。border-boxではない）ため、画像は固定pxではなく
  // 親の内側いっぱい（100%）に敷き、borderの有無で数値が2つに増えないようにする
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

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
  };

  const inner = imageUrl ? (
    <Image source={{ uri: imageUrl }} style={{ width: size, height: size }} />
  ) : (
    <Text size="md" weight="bold" color="brand">
      {initialOf(name)}
    </Text>
  );

  if (!glow) {
    return <View style={circleStyle}>{inner}</View>;
  }

  return (
    <View style={{ borderRadius: size / 2, ...shadow.glow }}>
      <View style={circleStyle}>{inner}</View>
    </View>
  );
}

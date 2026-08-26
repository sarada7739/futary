import { Image, View } from "react-native";
import { colors } from "../tokens";
import { Text } from "./text";
import { initialOf } from "./avatar-logic";

export { initialOf } from "./avatar-logic";

export type AvatarProps = {
  name: string;
  imageUrl?: string;
  size?: number;
};

export function Avatar({ name, imageUrl, size = 40 }: AvatarProps) {
  const style = {
    width: size,
    height: size,
    borderRadius: size / 2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: colors.primarySubtle,
    overflow: "hidden" as const,
  };

  if (imageUrl) {
    return (
      <View style={style}>
        <Image
          source={{ uri: imageUrl }}
          style={{ width: size, height: size }}
        />
      </View>
    );
  }

  return (
    <View style={style}>
      <Text size="md" weight="bold" color="brand">
        {initialOf(name)}
      </Text>
    </View>
  );
}

import { Screen, space, Text } from "@futary/ui";
import { View } from "react-native";

export default function AlbumScreen() {
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm }}>
        <Text size="lg" weight="bold">
          アルバム
        </Text>
        <Text color="muted">準備中です</Text>
      </View>
    </Screen>
  );
}

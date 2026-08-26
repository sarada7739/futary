import { Screen, Text } from "@futary/ui";
import { View } from "react-native";

export default function PostScreen() {
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Text size="lg" weight="bold">
          投稿
        </Text>
        <Text color="muted">準備中です</Text>
      </View>
    </Screen>
  );
}

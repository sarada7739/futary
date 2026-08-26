import { Avatar, Screen, space, Text } from "@futary/ui";
import { View } from "react-native";

export default function ProfileScreen() {
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md }}>
        <Avatar name="?" size={64} />
        <Text size="lg" weight="bold">
          マイページ
        </Text>
        <Text color="muted">準備中です</Text>
      </View>
    </Screen>
  );
}

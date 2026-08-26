import { Avatar, Screen, Text } from "@futary/ui";
import { View } from "react-native";

export default function ProfileScreen() {
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Avatar name="?" size={64} />
        <Text size="lg" weight="bold">
          マイページ
        </Text>
        <Text color="muted">準備中です</Text>
      </View>
    </Screen>
  );
}

import { Button, Screen, Text, space } from "@futary/ui";
import { useRouter } from "expo-router";
import { View } from "react-native";

export default function OnboardingChoiceScreen() {
  const router = useRouter();

  return (
    <Screen>
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: space.xxl,
          gap: space.xl,
        }}
      >
        <Text size="xl" weight="bold" color="brand">
          ふたりをはじめる
        </Text>
        <Text color="muted">パートナーとペアになりましょう</Text>
        <View style={{ width: "100%", gap: space.md }}>
          <Button onPress={() => router.push("/create")}>新しく作る</Button>
          <Button variant="secondary" onPress={() => router.push("/join")}>
            コードで参加する
          </Button>
        </View>
      </View>
    </Screen>
  );
}

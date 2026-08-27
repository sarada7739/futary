import { Avatar, Button, Screen, space, Text } from "@futary/ui";
import { View } from "react-native";
import { signOut, useSession } from "../../lib/auth-client";

export default function ProfileScreen() {
  const { data: session } = useSession();

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md }}>
        <Avatar
          name={session?.user.name ?? "?"}
          imageUrl={session?.user.image ?? undefined}
          size={64}
        />
        <Text size="lg" weight="bold">
          {session?.user.name ?? "マイページ"}
        </Text>
        <Text color="muted">{session?.user.email}</Text>
        <View style={{ marginTop: space.xl, width: 200 }}>
          <Button variant="secondary" onPress={() => signOut()}>
            ログアウト
          </Button>
        </View>
      </View>
    </Screen>
  );
}

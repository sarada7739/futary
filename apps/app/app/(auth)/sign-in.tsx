import { Button, Screen, Text, space } from "@futary/ui";
import { View } from "react-native";
import { signIn } from "../../lib/auth-client";

function handleGoogleSignIn() {
  void signIn.social({ provider: "google", callbackURL: "/" });
}

export default function SignInScreen() {
  return (
    <Screen>
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          alignItems: "center",
          padding: space.xxl,
          gap: space.xxl,
        }}
      >
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: space.sm }}>
          <Text size="xl" weight="bold" color="brand">
            futary
          </Text>
          <Text color="muted">大切な人と、ずっとつながるための</Text>
          <Text color="muted">ふたり専用SNS</Text>
        </View>

        <View style={{ width: "100%", gap: space.md }}>
          <Button onPress={handleGoogleSignIn}>ログイン</Button>
          <Button variant="secondary" onPress={handleGoogleSignIn}>
            新しくはじめる
          </Button>
          {/* ゲスト閲覧（未認証でのデモ表示）は014で実装する。それまでは無効表示 */}
          <Button variant="ghost" disabled>
            ゲストではじめる
          </Button>
        </View>
      </View>
    </Screen>
  );
}

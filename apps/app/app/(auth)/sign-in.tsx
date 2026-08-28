import { Button, Screen, Text, space } from "@futary/ui";
import { Platform, View } from "react-native";
import { signIn } from "../../lib/auth-client";

// callbackURL は Better Auth サーバー（apps/api）のオリジンを起点に相対解決される。
// ローカル開発では apps/app（Expo, 8081）と apps/api（wrangler dev, 8787）が
// 別ポートで動くため、"/" のような相対パスを渡すと apps/api 側の "/" に
// リダイレクトされ 404 になる（apps/api は /api/* しか公開していない）。
// Web は自身のオリジンへの絶対URLを渡す。本番は同一Workerから配信されるため、
// この絶対URL化はローカル開発時のみ意味を持つ
function resolveCallbackURL(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return "/";
}

// react-native-web の Pressable は環境によって onPress が1クリックで2回発火する
// （pointer系イベントと click イベントの両方が反応する既知の挙動）。
// signIn.social は Better Auth 側に OAuth の state を新規発行させるため、
// 2回呼ぶと2つの state が競合し、Google から戻ってきた時点で
// "State not persisted correctly" として弾かれる（実機確認で発生を確認）。
// 呼び出し中は再入しないようにガードする
let isSigningIn = false;

function handleGoogleSignIn() {
  if (isSigningIn) return;
  isSigningIn = true;
  void signIn.social({ provider: "google", callbackURL: resolveCallbackURL() }).finally(() => {
    isSigningIn = false;
  });
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

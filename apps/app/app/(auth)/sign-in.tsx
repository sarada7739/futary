import { useState } from "react";
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

export default function SignInScreen() {
  // react-native-web の Pressable は環境によって onPress が1クリックで2回発火する
  // （pointer系イベントと click イベントの両方が反応する既知の挙動）。
  // signIn.social は Better Auth 側に OAuth の state を新規発行させるため、
  // 2回呼ぶと2つの state が競合し、Google から戻ってきた時点で
  // "State not persisted correctly" として弾かれる（実機確認で発生を確認）。
  // state化してBoolean の disabled と連動させ、UI上も押せない状態を示す。
  // 成功時はページ遷移が始まるまでボタンを無効のままにする（signIn.social の
  // Promise は redirect 開始直後に resolve するため、finally で即座に戻すと
  // 遷移完了までの間にもう一度クリックされる余地が残る。security-auditor指摘）。
  // 失敗時のみ再試行できるよう戻す
  const [isSigningIn, setIsSigningIn] = useState(false);

  function handleGoogleSignIn() {
    if (isSigningIn) return;
    setIsSigningIn(true);
    void signIn.social({ provider: "google", callbackURL: resolveCallbackURL() }).then((result) => {
      if (result?.error) setIsSigningIn(false);
    });
  }

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
          <Button onPress={handleGoogleSignIn} disabled={isSigningIn}>
            ログイン
          </Button>
          <Button variant="secondary" onPress={handleGoogleSignIn} disabled={isSigningIn}>
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

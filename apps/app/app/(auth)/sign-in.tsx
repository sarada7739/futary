import { useRef, useState } from "react";
import { Button, fontFamily, logoMark, Screen, space, Text, useTheme } from "@futary/ui";
import { Image, Platform, Text as RNText, View } from "react-native";
import { LegalLinks } from "../../components/legal-links";
import { signIn } from "../../lib/auth-client";
import { useGuestMode } from "../../lib/guest-mode";

// callbackURL は Better Auth サーバ（apps/api）のオリジンから相対解決される。ローカルでは apps/app（8081）と
// apps/api（8787）が別ポートなので、相対パスだと apps/api の "/" に飛んで 404 になる。Web は自分のオリジンの
// 絶対 URL を渡す（本番は同一オリジンなのでローカルでだけ意味がある）。
// ログイン後はアプリ本体へ戻すので /app/ を付ける（付けないとランディングページに戻る）
function resolveCallbackURL(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return `${window.location.origin}/app/`;
  return "/";
}

// 中央に大きなロゴ（ワードマーク。比率 3.77）。ラスター画像なので、これ以上大きくすると粗さが目立つ
const LOGO_WIDTH = 240;
const LOGO_HEIGHT = 64;

export default function SignInScreen() {
  const { colors } = useTheme();
  // react-native-web の Pressable は環境によって onPress が 1 クリックで 2 回発火する（pointer と click の両方）。
  // signIn.social は OAuth の state を新しく作るので、2 回呼ぶと state が競合して Google から戻ったときに
  // "State not persisted correctly" で弾かれる。判定は useRef で同期に行う（useState だと同じ tick の
  // 2 回目がまだ false）。disabled の表示だけ useState
  const isSigningInRef = useRef(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { enterGuestMode, demoUnavailable } = useGuestMode();

  function handleGoogleSignIn() {
    if (isSigningInRef.current) return;
    isSigningInRef.current = true;
    setIsSigningIn(true);
    // 成功時は遷移が始まるまで無効のまま（Promise は redirect の開始直後に resolve するので、戻すと遷移までに
    // もう一度押せる）。失敗時だけ戻す
    void signIn.social({ provider: "google", callbackURL: resolveCallbackURL() }).then((result) => {
      if (result?.error) {
        isSigningInRef.current = false;
        setIsSigningIn(false);
      }
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
          {/* 中央に大きなロゴ（ホーム上部と同じ logoMark。新しいフォント・画像は増やさない） */}
          <Image
            source={logoMark}
            style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="Nisoine"
          />
          {/* タグラインは weight 400・字間 0.15em（2.4）・行送り 1.9（30.4）。共有の Text はこの字間・
              行送りを持たないので、ここだけ生の Text で組む */}
          <RNText
            style={{
              fontFamily: fontFamily.ja,
              fontSize: 16,
              fontWeight: "400",
              letterSpacing: 2.4,
              lineHeight: 30.4,
              color: colors.textMuted,
              textAlign: "center",
            }}
          >
            大切な人と、ずっとつながるための
          </RNText>
          <RNText
            style={{
              fontFamily: fontFamily.ja,
              fontSize: 16,
              fontWeight: "400",
              letterSpacing: 2.4,
              lineHeight: 30.4,
              color: colors.textMuted,
              textAlign: "center",
            }}
          >
            ふたり専用SNS
          </RNText>
        </View>

        <View style={{ width: "100%", gap: space.md }}>
          <Button onPress={handleGoogleSignIn} disabled={isSigningIn}>
            ログイン
          </Button>
          <Button variant="secondary" onPress={handleGoogleSignIn} disabled={isSigningIn}>
            新しくはじめる
          </Button>
          <Button variant="ghost" onPress={enterGuestMode} disabled={isSigningIn}>
            ゲストではじめる
          </Button>
          {/* デモの解決に失敗してここへ戻された直後だけ出す（黙って空白にしない。architecture.md 3節） */}
          {demoUnavailable && (
            <Text size="sm" color="muted" align="center">
              いまデモを見られません。しばらくしてからお試しください
            </Text>
          )}
          {/* 入る前にプライバシーポリシー・利用規約を読める（052） */}
          <LegalLinks />
        </View>
      </View>
    </Screen>
  );
}

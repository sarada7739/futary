import { useRef, useState } from "react";
import { Button, colors, fontFamily, logoMark, Screen, Text, space } from "@futary/ui";
import { Image, Platform, Text as RNText, View } from "react-native";
import { signIn } from "../../lib/auth-client";
import { useGuestMode } from "../../lib/guest-mode";

// callbackURL は Better Auth サーバー（apps/api）のオリジンを起点に相対解決される。
// ローカル開発では apps/app（Expo, 8081）と apps/api（wrangler dev, 8787）が
// 別ポートで動くため、"/" のような相対パスを渡すと apps/api 側の "/" に
// リダイレクトされ 404 になる（apps/api は /api/* しか公開していない）。
// Web は自身のオリジンへの絶対URLを渡す。本番は同一Workerから配信されるため、
// この絶対URL化はローカル開発時のみ意味を持つ。
//
// 【016で発見・修正】以前は `window.location.origin`（末尾に /app/ を
// 付けない、ドメインのルート）を返していた。015より前は「/」がアプリ本体
// だったためこれで正しかったが、015でランディングページを「/」に、
// アプリ本体を「/app/*」に分けたときにここを直し忘れていた
// （実機確認で発覚: ログイン完了後、アプリではなくランディングページ
// 〈「デモを見る」ボタンがある画面〉へ戻される）。ログイン後は必ず
// アプリ本体へ戻すため、/app/ を明示的に付ける
function resolveCallbackURL(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return `${window.location.origin}/app/`;
  return "/";
}

// 035タスク定義4節「中央に大きなロゴ」。logoMarkの元画像は168x59（比率2.85）で、
// ホーム上部の96x34より大きく出す。ラスター画像のため、これ以上大きくすると
// 粗さが目立つ（`docs/sample/README.md`に元画像の出どころの記載あり）
const LOGO_WIDTH = 224;
const LOGO_HEIGHT = 79;

export default function SignInScreen() {
  // react-native-web の Pressable は環境によって onPress が1クリックで2回発火する
  // （pointer系イベントと click イベントの両方が反応する既知の挙動）。
  // signIn.social は Better Auth 側に OAuth の state を新規発行させるため、
  // 2回呼ぶと2つの state が競合し、Google から戻ってきた時点で
  // "State not persisted correctly" として弾かれる（実機確認で発生を確認）。
  //
  // ガード判定は useRef で同期的に行う。useState の更新は非同期のため、
  // 同一 tick で2回 onPress が発火すると2回目の判定時点でもまだ false のままで
  // 両方通ってしまう可能性がある（Rレビュー指摘）。UI の disabled 表示だけは
  // useState で持ち、両ボタンに反映する
  const isSigningInRef = useRef(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { enterGuestMode, demoUnavailable } = useGuestMode();

  function handleGoogleSignIn() {
    if (isSigningInRef.current) return;
    isSigningInRef.current = true;
    setIsSigningIn(true);
    // 成功時はページ遷移が始まるまでボタンを無効のままにする（signIn.social の
    // Promise は redirect 開始直後に resolve するため、即座に戻すと遷移完了までの
    // 間にもう一度クリックされる余地が残る。security-auditor指摘）。
    // 失敗時のみ再試行できるよう戻す
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
          {/* 035タスク定義4節「中央に大きなロゴ」。ホーム上部と同じ
              logoMark（既存のブランドの手書き風ロゴ画像）を大きく出す。
              新しいフォント・新しい画像は増やさない */}
          <Image
            source={logoMark}
            style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="futary"
          />
          {/* 035書体仕様: タグラインはweight400・字間0.15em（16pt×0.15=2.4）・
              行送り1.9（16pt×1.9=30.4）。共有Textはletterspacing/この
              行送りを持たないため、ここだけ生Textで組む */}
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
          {/* デモの解決に失敗してここへ戻された直後だけ出す（黙って空白に
              しない。architecture.md 3節。Rレビュー指摘R-1・A決定） */}
          {demoUnavailable && (
            <Text size="sm" color="muted" align="center">
              いまデモを見られません。しばらくしてからお試しください
            </Text>
          )}
        </View>
      </View>
    </Screen>
  );
}

import { Stack } from "expo-router";

// (auth)/_layout.tsx と同じ理由。(onboarding)にも_layout.tsxが無く、
// ルート_layout.tsxのStack.Screen name="(onboarding)"がどの画面にも
// 一致せず、同じ警告が出ていた（今回の不具合の真因ではない。
// (auth)/_layout.tsxのコメント参照）
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

import { Stack } from "expo-router";

// グループには _layout.tsx が要る（(auth)/_layout.tsx と同じ理由）
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

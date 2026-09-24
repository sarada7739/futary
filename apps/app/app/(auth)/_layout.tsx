import { Stack } from "expo-router";

// グループには _layout.tsx が要る。無いと sign-in.tsx が "(auth)/sign-in" という平らな名前で登録され、
// ルートの Stack.Screen name="(auth)" がどの画面にも一致せず警告が出る（(tabs)・(onboarding) と同じ）
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

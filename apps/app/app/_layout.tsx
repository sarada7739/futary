import { Screen } from "@futary/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";
import { useSession } from "../lib/auth-client";

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  const { data: session, isPending } = useSession();

  if (isPending) {
    // 起動直後、セッション確認が終わるまでの一瞬だけ表示される
    return <Screen>{null}</Screen>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}

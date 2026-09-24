import { AppState, Platform } from "react-native";
import { QueryClient, focusManager } from "@tanstack/react-query";

// 通知を作らず、画面が前面にある間だけポーリングで更新する（ADR-008）。Web は visibilitychange を TanStack Query が
// 見ているので、ネイティブ（AppState）の分だけここで focusManager に配線する（背景では refetchInterval が止まる）
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (status) => {
    focusManager.setFocused(status === "active");
  });
}

export const queryClient = new QueryClient();

// post.list のポーリング間隔（ADR-008）
export const POST_LIST_REFETCH_INTERVAL_MS = 60_000;

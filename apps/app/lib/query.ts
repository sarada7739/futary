import { AppState, Platform } from "react-native";
import { QueryClient, focusManager } from "@tanstack/react-query";

// ADR-008: 通知を作らない。画面が前面にある間だけポーリングで更新を賄う。
// Web はブラウザの visibilitychange を TanStack Query が標準で見ているため、
// ネイティブ（AppState）の分だけここで focusManager に配線する。
// 背景に回ると focusManager が unfocused を返し、refetchInterval（既定の
// refetchIntervalInBackground: false）が自動的に止まる
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (status) => {
    focusManager.setFocused(status === "active");
  });
}

export const queryClient = new QueryClient();

// post.list のポーリング間隔（008・ADR-008）
export const POST_LIST_REFETCH_INTERVAL_MS = 60_000;

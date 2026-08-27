import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { apiOrigin } from "./api-origin";

// Web は Cookie ベースのセッションで完結する（fetch の credentials: include で送られる）。
// ネイティブは Cookie を保持できないため、Expo SecureStore にセッショントークンを保存する
// （security-requirements.md 2節: AsyncStorage には置かない）
export const authClient = createAuthClient({
  baseURL: apiOrigin,
  plugins:
    Platform.OS === "web"
      ? []
      : [
          expoClient({
            scheme: "futary",
            storagePrefix: "futary",
            storage: SecureStore,
          }),
        ],
});

export const { signIn, signOut, useSession } = authClient;

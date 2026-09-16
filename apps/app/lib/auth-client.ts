import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { getApiOrigin } from "./api-origin";
import { frameCredentials } from "./demo-frame";

// Web は Cookie ベースのセッションで完結する（fetch の credentials: include で送られる）。
// ネイティブは Cookie を保持できないため、Expo SecureStore にセッショントークンを保存する
// （security-requirements.md 2節: AsyncStorage には置かない）。
// 056: LP のスマホの枠（iframe）の中では Cookie を送らない（frameCredentials → "omit"）。ログイン中のブラウザでも
// 框の中のセッションは null になり、実ユーザーの画面が框に写らない。ネイティブでは isInFrame が false で "include" のまま
export const authClient = createAuthClient({
  baseURL: getApiOrigin(),
  fetchOptions: {
    customFetchImpl: (input, init) => fetch(input, { ...init, credentials: frameCredentials() }),
  },
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

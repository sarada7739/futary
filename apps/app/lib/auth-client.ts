import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { getApiOrigin } from "./api-origin";
import { frameCredentials } from "./demo-frame";

// Web は Cookie のセッションで完結する（credentials: include）。ネイティブは Cookie を保てないので SecureStore に
// トークンを置く（AsyncStorage には置かない。security-requirements.md 2節）。
// LP のスマホの枠の中では Cookie を送らない（frameCredentials → "omit"。枠の中のセッションは null になる。056）
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

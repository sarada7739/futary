import { Linking, Pressable, View } from "react-native";
import { space, Text } from "@futary/ui";
import { getApiOrigin } from "../lib/api-origin";

// 052: プライバシーポリシー・利用規約へのリンク。サインイン画面の下と
// マイページの下の両方に置く（タスク定義 0節 4「入る前と入った後の両方から辿れる」）。
//
// ページはランディングと同じ静的 HTML（apps/landing/privacy.html・terms.html）で、
// アプリ（/app/*）の外にある。expo-router の Link は baseUrl（/app）の中しか
// 指せないため、Linking.openURL でサイトのルートの URL を開く。
// オリジンは getApiOrigin() から取る: 本番はアプリと API が同一オリジンなので
// window.location.origin、ローカル開発は EXPO_PUBLIC_API_ORIGIN（wrangler dev。
// build:public 済みなら /privacy も返す）。Web では新しいタブで開く
// （react-native-web の Linking.openURL は window.open(url, "_blank")）ので、
// 入力途中のマイページを離れない
export const LEGAL_PAGES = [
  { path: "/privacy", label: "プライバシーポリシー", testID: "legal-privacy" },
  { path: "/terms", label: "利用規約", testID: "legal-terms" },
  // 048 段階2: 特定商取引法に基づく表記（/premium の下にだけ出す。既定の 2 つには含めない）
  { path: "/tokushoho", label: "特定商取引法に基づく表記", testID: "legal-tokushoho" },
] as const;

export type LegalPagePath = (typeof LEGAL_PAGES)[number]["path"];

export function legalPageUrl(path: LegalPagePath): string {
  return `${getApiOrigin()}${path}`;
}

const DEFAULT_PAGES: readonly LegalPagePath[] = ["/privacy", "/terms"];

export function LegalLinks({ pages = DEFAULT_PAGES }: { pages?: readonly LegalPagePath[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: space.lg }}>
      {LEGAL_PAGES.filter((page) => pages.includes(page.path)).map((page) => (
        <Pressable
          key={page.path}
          accessibilityRole="link"
          accessibilityLabel={page.label}
          onPress={() => void Linking.openURL(legalPageUrl(page.path))}
          hitSlop={space.sm}
          testID={page.testID}
        >
          <Text size="sm" color="muted">
            {page.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

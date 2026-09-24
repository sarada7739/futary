import { Linking, Pressable, View } from "react-native";
import { space, Text } from "@futary/ui";
import { getApiOrigin } from "../lib/api-origin";

// プライバシーポリシー・利用規約へのリンク。サインイン画面とマイページの下の両方に置く（052）。
// ページはランディングと同じ静的 HTML で /app/* の外にあり、expo-router の Link は baseUrl の中しか指せないので
// Linking.openURL でサイトのルートの URL を開く。オリジンは getApiOrigin()（本番は同一オリジン、ローカルは
// EXPO_PUBLIC_API_ORIGIN）。Web では新しいタブで開くので、入力途中のマイページを離れない
export const LEGAL_PAGES = [
  { path: "/privacy", label: "プライバシーポリシー", testID: "legal-privacy" },
  { path: "/terms", label: "利用規約", testID: "legal-terms" },
  // 特定商取引法に基づく表記（/premium の下にだけ出す。既定の 2 つには含めない）
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

import { Image, Pressable, View } from "react-native";
import { FREE_ALBUM_PHOTO_LIMIT } from "@futary/contract";
import { Button, Card, iconLock, radius, space, Text, useTheme } from "@futary/ui";
import { freePlanLimitLabel, paidPhotoLimitLabel } from "../lib/plan";
import { Sheet } from "./sheet";

// 写真の上限に達したときのシート（045）。アルバム詳細の FAB・作成の「カバー写真を選択」・サーバの PLAN_LIMIT の
// 3 箇所で同じものを出す。鍵の絵 → 題 → 副題 → 現在のプラン（「30 枚まで保存可能」の 1 行）→ ↓ → プレミアム
// （「写真 50 万枚まで」の 1 行。「無制限」と書かず、価格も出さない）→「プレミアムプランを見る ›」→「× あとで検討する」。
// 「無料トライアル」は出さない

// 鍵の丸は 72（絵は 96×96 の線画を 40 で）。ピルは高さ 22
const LOCK_CIRCLE = 72;
const LOCK_ICON = 40;
const PILL_HEIGHT = 22;
const BULLET = 6;

function Pill({ label, tone, testID }: { label: string; tone: "muted" | "brand"; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        height: PILL_HEIGHT,
        paddingHorizontal: space.sm,
        borderRadius: radius.pill,
        backgroundColor: tone === "brand" ? colors.primary : colors.surfaceTint,
        justifyContent: "center",
      }}
    >
      <Text size="xs" weight="bold" color={tone === "brand" ? "inverse" : "muted"}>
        {label}
      </Text>
    </View>
  );
}

export type PlanLimitSheetProps = {
  visible: boolean;
  onClose: () => void;
  // 呼び出し側が /premium へ進む（シートは閉じてから）
  onPremium: () => void;
};

export function PlanLimitSheet({ visible, onClose, onPremium }: PlanLimitSheetProps) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View testID="plan-limit-sheet" style={{ alignItems: "center", gap: space.sm }}>
        <View
          style={{
            width: LOCK_CIRCLE,
            height: LOCK_CIRCLE,
            borderRadius: LOCK_CIRCLE / 2,
            backgroundColor: colors.primarySubtle,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image
            testID="plan-limit-lock"
            source={iconLock}
            style={{ width: LOCK_ICON, height: LOCK_ICON, tintColor: colors.primary }}
            resizeMode="contain"
          />
        </View>
        <Text size="lg" weight="bold" align="center" testID="plan-limit-title">
          写真の上限に達しました
        </Text>
        <Text size="sm" color="muted" align="center" testID="plan-limit-message">
          大切な思い出をもっと残すために、プレミアムプランへ。
        </Text>
      </View>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text weight="bold">現在のプラン - 無料</Text>
          <Pill label="FREE" tone="muted" />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm }}>
          <View style={{ width: BULLET, height: BULLET, borderRadius: BULLET / 2, backgroundColor: colors.textMuted }} />
          <Text size="sm" color="muted" testID="plan-limit-free-line">
            {freePlanLimitLabel(FREE_ALBUM_PHOTO_LIMIT)}
          </Text>
        </View>
      </Card>

      <Text color="brand" align="center">
        ↓
      </Text>

      <Card accent>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text weight="bold">プレミアムプラン</Text>
          <Pill label="PREMIUM" tone="brand" />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm }}>
          <Text color="brand" weight="bold">
            ✓
          </Text>
          <Text size="sm" testID="plan-limit-premium-line">
            {paidPhotoLimitLabel()}
          </Text>
        </View>
        <View style={{ marginTop: space.md }}>
          <Button onPress={onPremium} testID="plan-limit-premium">
            プレミアムプランを見る ›
          </Button>
        </View>
      </Card>

      <View style={{ alignItems: "center" }}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={space.sm} testID="plan-limit-close">
          <Text size="sm" color="muted">
            × あとで検討する
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

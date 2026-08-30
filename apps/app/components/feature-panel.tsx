import { Pressable, View } from "react-native";
import { Card, colors, radius, space, Text } from "@futary/ui";

export type FeaturePanelProps = {
  label: string;
  description?: string;
  onPress?: () => void;
};

// 020: ホームの機能パネル。動くもの（onPressあり）と次フェーズのもの
// （onPressなし）の両方をこの1つのコンポーネントで表す。
// 「準備中です」という文言は使わない（作りかけに見える。作らないと決めた、
// ではなく次に作ると決めた）。押せないこと自体で「いま押せない」が伝わる形にし、
// 押したら何か起きたように見せない（onPressが無ければPressableにしない）
export function FeaturePanel({ label, description, onPress }: FeaturePanelProps) {
  const isNextPhase = !onPress;

  const content = (
    <Card>
      <View style={{ gap: space.xs, opacity: isNextPhase ? 0.5 : 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text weight="bold">{label}</Text>
          {isNextPhase && (
            <View
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.pill,
                paddingHorizontal: space.sm,
                paddingVertical: 2,
              }}
            >
              <Text size="xs" color="muted">
                次フェーズ
              </Text>
            </View>
          )}
        </View>
        {description && (
          <Text size="xs" color="muted">
            {description}
          </Text>
        )}
      </View>
    </Card>
  );

  if (!onPress) return content;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {content}
    </Pressable>
  );
}

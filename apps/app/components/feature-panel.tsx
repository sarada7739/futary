import type { ImageSourcePropType } from "react-native";
import { Image, Pressable, View } from "react-native";
import { colors, space, Text } from "@futary/ui";

export type FeaturePanelProps = {
  label: string;
  icon: ImageSourcePropType;
  onPress?: () => void;
};

const ICON_SIZE = 32;
// ラベルが2行に折り返しても8枚の高さが揃うよう固定する（「今日どうだった？」が
// スマホ幅の4列で1行に入らないため。docs/tasks/020-home-panels.md）
const CELL_HEIGHT = 92;

// 020: ホームの機能パネル。モックアップの4列グリッドに合わせ、枠線も背景も
// 持たない（押せる/押せないの差を枠ではなく濃さで見せるため。薄い枠は
// 「押せそうな箱」に見える）。説明文は持たない（ラベルがパネル名そのもので
// 曖昧ではない）。動くもの（onPressあり）と次フェーズのもの（onPressなし）を
// この1つのコンポーネントで表す。「準備中です」という文言は使わない
export function FeaturePanel({ label, icon, onPress }: FeaturePanelProps) {
  const isNextPhase = !onPress;

  const content = (
    <View style={{ gap: space.xs, opacity: isNextPhase ? 0.5 : 1 }}>
      <Image
        source={icon}
        style={{ width: ICON_SIZE, height: ICON_SIZE, alignSelf: "center", tintColor: colors.text }}
        resizeMode="contain"
      />
      <Text size="xs" weight="bold" align="center" numberOfLines={2}>
        {label}
      </Text>
      {isNextPhase && (
        <Text size="xs" color="muted" align="center">
          次フェーズ
        </Text>
      )}
    </View>
  );

  return (
    <View style={{ width: "25%", height: CELL_HEIGHT, paddingTop: space.sm, paddingHorizontal: space.xs }}>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
          {content}
        </Pressable>
      ) : (
        content
      )}
    </View>
  );
}

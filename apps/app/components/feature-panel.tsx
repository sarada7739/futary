import type { ReactNode } from "react";
import type { ImageSourcePropType } from "react-native";
import { Image, Pressable, View } from "react-native";
import { colors, lineHeights, radius, shadow, space, Text } from "@futary/ui";

export type FeaturePanelProps = {
  label: string;
  icon: ImageSourcePropType;
  onPress?: () => void;
};

const ICON_SIZE = 32;
const LABEL_LINES = 2;
const BADGE_LINES = 1;
const CARD_PADDING = space.sm;
// ラベルが2行に折り返しても8枚の高さが揃うよう固定する（「今日どうだった？」が
// スマホ幅の4列で1行に入らないため。docs/tasks/020-home-panels.md）。
// 一番きついのは、2行に折り返すラベルと「COMING SOON」の行を両方持つパネル
// （「今日どうだった？」）。数値を積み上げて導出する（勘で決めない。
// Rレビュー指摘: 92では文字の行の高さを明示していないぶんの余白が足りなかった）
const CELL_HEIGHT =
  CARD_PADDING * 2 +
  ICON_SIZE +
  space.xs + // アイコンとラベルの間のgap
  lineHeights.xs * LABEL_LINES +
  space.xs + // ラベルとバッジ行の間のgap
  lineHeights.xs * BADGE_LINES;

// 035（見た目を作り込む）: 020で「枠線も背景も持たない」と決めたが、モックが
// 白い面＋影（枠線ではない）だったため判断を覆した（020が嫌ったのは薄い枠
// 〈押せそうな箱に見える〉であり、モックはそれとは別物。035タスク定義2節）。
// 押せる/押せないの差は020と同じく濃さ（opacity）で見せる、という考え方は
// 維持する。`Card`コンポーネントは4列グリッドに対しpaddingが大きすぎるため
// 使わず、同じトークン（surface・radius.card・shadow.card）を直接当てる
function PanelSurface({ children, isNextPhase }: { children: ReactNode; isNextPhase: boolean }) {
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: CARD_PADDING,
        opacity: isNextPhase ? 0.6 : 1,
        ...shadow.card,
      }}
    >
      {children}
    </View>
  );
}

// 020: ホームの機能パネル。説明文は持たない（ラベルがパネル名そのもので
// 曖昧ではない）。動くもの（onPressあり）と次フェーズのもの（onPressなし）を
// この1つのコンポーネントで表す。「次フェーズ」という開発都合の言葉は使わず
// 「COMING SOON」にする（035タスク定義2節。利用者の言葉ではない、という
// 理由。字種の趣味の話ではなく文言の質の話）
export function FeaturePanel({ label, icon, onPress }: FeaturePanelProps) {
  const isNextPhase = !onPress;

  const content = (
    <View style={{ gap: space.xs, height: CELL_HEIGHT - CARD_PADDING * 2 }}>
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
          COMING SOON
        </Text>
      )}
    </View>
  );

  return (
    <View style={{ width: "25%", padding: space.xs }}>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
          <PanelSurface isNextPhase={isNextPhase}>{content}</PanelSurface>
        </Pressable>
      ) : (
        <PanelSurface isNextPhase={isNextPhase}>{content}</PanelSurface>
      )}
    </View>
  );
}

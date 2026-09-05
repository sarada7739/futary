import type { ReactNode } from "react";
import type { ImageSourcePropType } from "react-native";
import { Image, Pressable, Text as RNText, View } from "react-native";
import { colors, fontFamily, radius, shadow } from "@futary/ui";

export type FeaturePanelProps = {
  label: string;
  icon: ImageSourcePropType;
  onPress?: () => void;
  // 呼び出し側（グリッド）が実測して渡すpx幅。react-native-webは
  // columnGapと"25%"のようなパーセント幅を併用しても幅を自動で詰め直さない
  // ため（4列×25%+3個ぶんのgapが1列分コンテナ幅を超え、5列目に見えるはずの
  // ものが折り返して3列になる不具合を実測で発見した）、親がonLayoutで測った
  // 幅から算出したpxを渡す。測定前（初回描画）は25%にフォールバックする
  width?: number;
};

// 035視覚仕様3節の数値。カード幅（76）・行間（12）はグリッド側
// （apps/app/app/(tabs)/index.tsx）のcolumnGap/rowGapで作るため、ここでは
// カードの中身の寸法だけを持つ
const ICON_SIZE = 28;
// 視覚仕様3節は96だが、「今日どうだった？」（ラベル2行）+COMING SOON（1行）の
// 実際の中身が96に収まらず、COMING SOONがカードの下にはみ出していた
// （Aの指摘・人間の実機確認で発覚）。全セル同じ高さのまま108→113に上げて
// 解消した（108は`letterSpacing:0.8`・システムフォントでの暫定値。書体
// 仕様でCOMING SOONをPoppins/8pt/字間0.08emに変えたところ実測で1行の高さが
// 11→16pxに伸び、108でも4pxはみ出したため113に再調整した）
const CARD_HEIGHT = 113;

// 035（見た目を作り込む）: 020で「枠線も背景も持たない」と決めたが、モックが
// 白い面＋影（枠線ではない）だったため判断を覆した（020が嫌ったのは薄い枠
// 〈押せそうな箱に見える〉であり、モックはそれとは別物。035タスク定義2節）。
// 押せる/押せないの差は020と同じく濃さ（opacity）で見せる、という考え方は
// 維持する。`Card`コンポーネントは4列グリッドに対しpaddingが大きすぎるため
// 使わず、同じ考え方のトークンを直接当てる。角丸は`radius.card`(20)だと
// 76幅のカードには重いため`radius.input`(14)を使う（視覚仕様3節）
function PanelSurface({ children, isNextPhase }: { children: ReactNode; isNextPhase: boolean }) {
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.input,
        paddingTop: 18,
        paddingHorizontal: 4,
        height: CARD_HEIGHT,
        opacity: isNextPhase ? 0.7 : 1,
        alignItems: "center",
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
// 理由。字種の趣味の話ではなく文言の質の話）。
//
// 「今日どうだった？」だけラベルが2行になる（A の判断・035視覚仕様3節）。
// 機能の名前を見た目のために削らない・1枚だけフォントサイズを変えると
// 次に長いラベルが出たときにまた1枚だけ変えることになる、という理由で
// そのままにしてある（`numberOfLines`を指定しないため自然に折り返す）
export function FeaturePanel({ label, icon, onPress, width }: FeaturePanelProps) {
  const isNextPhase = !onPress;
  const iconColor = isNextPhase ? colors.textMuted : colors.brandInk;
  const labelTextColor = isNextPhase ? colors.textMuted : colors.text;

  const content = (
    <>
      <Image
        source={icon}
        style={{ width: ICON_SIZE, height: ICON_SIZE, tintColor: iconColor }}
        resizeMode="contain"
      />
      {/* 11pt×6文字=66≤内側68で「タイムライン」が1行に入る
          （視覚仕様3節。12pt以上だと375幅では入らない） */}
      <RNText
        style={{
          fontFamily: fontFamily.ja,
          marginTop: 14,
          fontSize: 11,
          fontWeight: "600",
          lineHeight: 16,
          color: labelTextColor,
          textAlign: "center",
        }}
      >
        {label}
      </RNText>
      {isNextPhase && (
        // 035書体仕様: 「COMING SOON」は英字のみ→Poppins weight500・字間0.08em
        // （8pt×0.08=0.64）。letterSpacing 0.8では2行に折り返していたラベル
        // ("今日どうだった？"等)の高さ超過対策とは別の値のため、0.64で
        // 1行に収まるか確認しながら適用する
        <RNText
          style={{
            fontFamily: fontFamily.numeric,
            marginTop: 4,
            fontSize: 8,
            fontWeight: "500",
            letterSpacing: 0.64,
            color: colors.textMuted,
            textAlign: "center",
            textTransform: "uppercase",
          }}
        >
          COMING SOON
        </RNText>
      )}
    </>
  );

  return (
    <View style={{ width: width ?? "25%" }}>
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

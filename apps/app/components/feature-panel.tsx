import type { ReactNode } from "react";
import type { ImageSourcePropType } from "react-native";
import { Image, Pressable, Text as RNText, View } from "react-native";
import { fontFamily, radius, useTheme } from "@futary/ui";

export type FeaturePanelProps = {
  label: string;
  icon: ImageSourcePropType;
  // 039 段階2-c: ホワイトの写真タイル。無ければタイルの中に線画アイコンを置く
  // （写真はホワイトでしか使わない。ピンクは従来どおりアイコンだけ）
  photo?: ImageSourcePropType;
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

// 039 段階2-c（ホワイト）の数値。B が決めた:
// - タイルは正方形（幅いっぱい。aspectRatio で作るので幅の実測を待たない）
// - ラベルは2行ぶん（16×2）を常に確保し、「近日公開」も1行ぶん（14）を常に確保する
//   （使える/使えないでカードの高さが変わると、4列のグリッドで底が揃わない）
// - 内側の余白 6。写真タイルの角丸は radius.input(14)（タスク定義 5-2 c）
const WHITE_PADDING = 6;
const WHITE_LABEL_LINES = 2;
const WHITE_LABEL_LINE_HEIGHT = 16;
const WHITE_NOTE_HEIGHT = 14;

// 035（見た目を作り込む）: 020で「枠線も背景も持たない」と決めたが、モックが
// 白い面＋影（枠線ではない）だったため判断を覆した（020が嫌ったのは薄い枠
// 〈押せそうな箱に見える〉であり、モックはそれとは別物。035タスク定義2節）。
// 押せる/押せないの差は020と同じく濃さ（opacity）で見せる、という考え方は
// 維持する。`Card`コンポーネントは4列グリッドに対しpaddingが大きすぎるため
// 使わず、同じ考え方のトークンを直接当てる。角丸は`radius.card`(20)だと
// 76幅のカードには重いため`radius.input`(14)を使う（視覚仕様3節）
function PanelSurface({ children, isNextPhase }: { children: ReactNode; isNextPhase: boolean }) {
  const { colors, shadow } = useTheme();
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

// 039 段階2-c: ホワイトのパネル。白いカード + border 1px（影無し）の中に、正方形の
// 写真タイル + 日本語ラベル + 使えないものは「近日公開」（muted）。「COMING SOON」は
// 出さない。濃さ（opacity）で押せる/押せないを見せることはしない（モックは写真を
// そのまま見せ、「近日公開」の文字だけで伝えている）
function WhitePanel({
  label,
  icon,
  photo,
  isNextPhase,
}: {
  label: string;
  icon: ImageSourcePropType;
  photo?: ImageSourcePropType;
  isNextPhase: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      testID="feature-panel-white"
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.input,
        borderWidth: 1,
        borderColor: colors.border,
        padding: WHITE_PADDING,
        alignItems: "center",
      }}
    >
      <View
        style={{
          width: "100%",
          aspectRatio: 1,
          borderRadius: radius.input,
          backgroundColor: colors.surfaceTint,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {photo ? (
          <Image
            testID="feature-panel-photo"
            source={photo}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Image
            source={icon}
            style={{ width: ICON_SIZE, height: ICON_SIZE, tintColor: colors.brandInk }}
            resizeMode="contain"
          />
        )}
      </View>
      <RNText
        style={{
          fontFamily: fontFamily.ja,
          marginTop: 8,
          fontSize: 11,
          fontWeight: "600",
          lineHeight: WHITE_LABEL_LINE_HEIGHT,
          height: WHITE_LABEL_LINE_HEIGHT * WHITE_LABEL_LINES,
          color: colors.text,
          textAlign: "center",
        }}
      >
        {label}
      </RNText>
      {/* 高さを常に確保する（上記）。使えるものは空のまま */}
      <RNText
        style={{
          fontFamily: fontFamily.ja,
          fontSize: 10,
          lineHeight: WHITE_NOTE_HEIGHT,
          height: WHITE_NOTE_HEIGHT,
          color: colors.textMuted,
          textAlign: "center",
        }}
      >
        {isNextPhase ? "近日公開" : ""}
      </RNText>
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
export function FeaturePanel({ label, icon, photo, onPress, width }: FeaturePanelProps) {
  const { appearance, colors } = useTheme();
  const isNextPhase = !onPress;
  const iconColor = isNextPhase ? colors.textMuted : colors.brandInk;
  const labelTextColor = isNextPhase ? colors.textMuted : colors.text;

  // 039 段階2-c: 分岐はこの部品の中（タスク定義 5-2「分岐は部品の中に閉じる」）
  const content =
    appearance === "white" ? (
      <WhitePanel label={label} icon={icon} photo={photo} isNextPhase={isNextPhase} />
    ) : (
      <PanelSurface isNextPhase={isNextPhase}>
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
      </PanelSurface>
    );

  return (
    <View style={{ width: width ?? "25%" }}>
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

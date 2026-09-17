import type { ImageSourcePropType } from "react-native";
import { Image, Pressable, Text as RNText, View } from "react-native";
import { fontFamily, radius, useTheme } from "@futary/ui";

export type FeaturePanelProps = {
  label: string;
  icon: ImageSourcePropType;
  // 正方形の写真タイル（packages/ui/src/assets.ts の panelPhoto*）。無ければ
  // タイルの中に線画アイコンを置く（差し替え口。062 の 0節 #4）
  photo?: ImageSourcePropType;
  onPress?: () => void;
  // 呼び出し側（グリッド）が実測して渡すpx幅。react-native-webは
  // columnGapと"25%"のようなパーセント幅を併用しても幅を自動で詰め直さない
  // ため（4列×25%+3個ぶんのgapが1列分コンテナ幅を超え、5列目に見えるはずの
  // ものが折り返して3列になる不具合を実測で発見した）、親がonLayoutで測った
  // 幅から算出したpxを渡す。測定前（初回描画）は25%にフォールバックする
  width?: number;
};

// 062: ホームの機能パネル。ピンクもホワイトも同じ形（外観で分けない）。
// 白いカード（`colors.surface` + 1px の `colors.border` + `shadow.card`）の中に、
// 正方形の写真タイル + 日本語ラベル + 注記の行。外観の違いは useTheme() の
// 色と影だけ（ピンクは影あり・枠線は地とほぼ同色で見えない。ホワイトは影が
// 無しで枠線だけ。039 の 4 節）。この部品の中で appearance を読まない。
//
// - タイルは正方形（幅いっぱい。aspectRatio で作るので幅の実測を待たない）。
//   地は `colors.surfaceTint`（写真が読み込まれるまでだけ見える）
// - ラベルは 2 行ぶん（16×2）を常に確保し、注記も 1 行ぶん（14）を常に確保する
//   （使える/使えないでカードの高さが変わると、4 列のグリッドで底が揃わない）
// - 使えないもの（onPress 無し）は注記に「近日公開」（textMuted）。使えるものは空。
//   濃さ（opacity）で押せる/押せないを見せることはしない。文字だけで伝える
// - 内側の余白 6。角丸は radius.input（14）。`radius.card`（20）は 76 幅には重い
// - 「タイムライン」（6 文字）が 11pt で 1 行に入る。12pt 以上だと 375 幅では入らない
const ICON_SIZE = 28;
const PANEL_PADDING = 6;
const LABEL_LINES = 2;
const LABEL_LINE_HEIGHT = 16;
const NOTE_HEIGHT = 14;

export function FeaturePanel({ label, icon, photo, onPress, width }: FeaturePanelProps) {
  const { colors, shadow } = useTheme();
  const isNextPhase = !onPress;

  const content = (
    <View
      testID="feature-panel"
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.input,
        borderWidth: 1,
        borderColor: colors.border,
        padding: PANEL_PADDING,
        alignItems: "center",
        ...shadow.card,
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
          lineHeight: LABEL_LINE_HEIGHT,
          height: LABEL_LINE_HEIGHT * LABEL_LINES,
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
          lineHeight: NOTE_HEIGHT,
          height: NOTE_HEIGHT,
          color: colors.textMuted,
          textAlign: "center",
        }}
      >
        {isNextPhase ? "近日公開" : ""}
      </RNText>
    </View>
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

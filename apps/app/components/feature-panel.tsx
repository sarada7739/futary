import type { ImageSourcePropType } from "react-native";
import { Image, Pressable, Text as RNText, View } from "react-native";
import { fontFamily, radius, useTheme } from "@futary/ui";

export type FeaturePanelProps = {
  label: string;
  icon: ImageSourcePropType;
  // 正方形の写真タイル（assets.ts の panelPhoto*）。無ければタイルの中に線画アイコン（差し替え口）
  photo?: ImageSourcePropType;
  onPress?: () => void;
  // 呼び出し側（グリッド）が実測して渡す px 幅（react-native-web は columnGap とパーセント幅を併用しても
  // 詰め直さない）。測る前（初回の描画）は 25%
  width?: number;
};

// ホームの機能パネル。ピンクもホワイトも同じ形: 白いカード（surface + 1px の border + shadow.card）の中に、
// 正方形の写真タイル + ラベル + 注記の行。外観の違いは useTheme() の色と影だけで、ここで appearance を読まない（062）。
// - タイルは aspectRatio で正方形（幅の実測を待たない）。地の surfaceTint は写真が読み込まれるまでだけ見える
// - ラベルは 2 行（16×2）、注記も 1 行（14）を常に確保する（使える/使えないでグリッドの底が揃わなくならない）
// - 使えないものは注記に「近日公開」。濃さ（opacity）で押せる/押せないを見せない
// - 角丸は radius.input（radius.card は 76 幅には重い）。「タイムライン」が 11pt で 1 行に入る
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
      {/* 高さを常に確保する。使えるものは空のまま */}
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

import type { ReactNode } from "react";
import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { useTheme } from "../appearance";
import { fontFamily } from "../tokens";
import type { Colors } from "../theme";

const sizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 28,
} as const;

// lineHeight を明示しないとブラウザ既定（フォント依存）になり、複数行を含むレイアウトの高さを計算できない。
// size ごとに固定し、呼び出し側から変える手段は持たせない（`style` と同じ理由）
export const lineHeights = {
  xs: 16,
  sm: 20,
  md: 22,
  lg: 26,
  xl: 34,
} as const;

export type TextSize = keyof typeof sizes;
export type TextColor = "default" | "muted" | "brand" | "inverse";

// 色は外観で変わるので描画時に引く
function textColorsOf(colors: Colors): Record<TextColor, string> {
  return {
    default: colors.text,
    muted: colors.textMuted,
    brand: colors.brandInk,
    inverse: colors.surface,
  };
}

export type TextAlign = "left" | "center" | "right";

// ラベル（タイムライン・統計・ログイン）は W6 相当で、400 と 700 の 2 択では再現できないので値を 1 つ足した
const fontWeights = {
  regular: "400",
  medium: "600",
  bold: "700",
} as const;

export type TextProps = Omit<RNTextProps, "style"> & {
  size?: TextSize;
  color?: TextColor;
  weight?: "regular" | "medium" | "bold";
  align?: TextAlign;
  children: ReactNode;
};

export function Text({
  size = "md",
  color = "default",
  weight = "regular",
  align = "left",
  children,
  ...rest
}: TextProps) {
  const { colors } = useTheme();
  return (
    <RNText
      {...rest}
      style={{
        fontFamily: fontFamily.ja,
        fontSize: sizes[size],
        lineHeight: lineHeights[size],
        color: textColorsOf(colors)[color],
        fontWeight: fontWeights[weight],
        textAlign: align,
      }}
    >
      {children}
    </RNText>
  );
}

import type { ReactNode } from "react";
import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { colors, fontFamily } from "../tokens";

const sizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 28,
} as const;

// lineHeightを明示しないとブラウザ既定（フォント依存。日本語は概ね1.4〜1.5倍）に
// なり、複数行のテキストを含むレイアウトの高さが計算できない
// （fix/panel-icon-grid。Rレビュー指摘）。呼び出し側が高さを算出できるよう、
// sizeごとに固定する。呼び出し側から変更する手段は持たせない（`style`と同じ理由）
export const lineHeights = {
  xs: 16,
  sm: 20,
  md: 22,
  lg: 26,
  xl: 34,
} as const;

export type TextSize = keyof typeof sizes;
export type TextColor = "default" | "muted" | "brand" | "inverse";

const textColors: Record<TextColor, string> = {
  default: colors.text,
  muted: colors.textMuted,
  brand: colors.brandInk,
  inverse: colors.surface,
};

export type TextAlign = "left" | "center" | "right";

// 035書体仕様3節: モックのラベル（タイムライン・統計・ログイン）はW6相当で、
// regular(400)とbold(700)の2択では再現できないため、既存の軸に値を1つ
// 足した（新しい軸は増やしていない）
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
  return (
    <RNText
      {...rest}
      style={{
        fontFamily: fontFamily.ja,
        fontSize: sizes[size],
        lineHeight: lineHeights[size],
        color: textColors[color],
        fontWeight: fontWeights[weight],
        textAlign: align,
      }}
    >
      {children}
    </RNText>
  );
}

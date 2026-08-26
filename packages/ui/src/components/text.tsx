import type { ReactNode } from "react";
import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { colors } from "../tokens";

const sizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 28,
} as const;

export type TextSize = keyof typeof sizes;
export type TextColor = "default" | "muted" | "brand" | "inverse";

const textColors: Record<TextColor, string> = {
  default: colors.text,
  muted: colors.textMuted,
  brand: colors.brandInk,
  inverse: colors.surface,
};

export type TextProps = Omit<RNTextProps, "style"> & {
  size?: TextSize;
  color?: TextColor;
  weight?: "regular" | "bold";
  children: ReactNode;
};

export function Text({
  size = "md",
  color = "default",
  weight = "regular",
  children,
  ...rest
}: TextProps) {
  return (
    <RNText
      {...rest}
      style={{
        fontSize: sizes[size],
        color: textColors[color],
        fontWeight: weight === "bold" ? "700" : "400",
      }}
    >
      {children}
    </RNText>
  );
}

import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { colors, radius, space } from "../tokens";

export type BadgeTone = "subtle" | "muted";

export type BadgeProps = Omit<ViewProps, "style"> & {
  children: ReactNode;
  // subtle: 「会った日数：94日」のような主役寄りの数値表示。
  // muted: 「COMING SOON」のような控えめな表示（035タスク定義2節・5節）
  tone?: BadgeTone;
};

const toneBackgrounds: Record<BadgeTone, string> = {
  subtle: colors.primarySubtle,
  muted: colors.surfaceTint,
};

// ピル型のバッジ。中身（Text）は呼び出し側が組み立てる（Cardと同じくstyleを
// 受け取らない。architecture.md 7節）
export function Badge({ children, tone = "subtle", ...rest }: BadgeProps) {
  return (
    <View
      {...rest}
      style={{
        alignSelf: "flex-start",
        backgroundColor: toneBackgrounds[tone],
        borderRadius: radius.pill,
        paddingVertical: space.xs,
        paddingHorizontal: space.md,
      }}
    >
      {children}
    </View>
  );
}

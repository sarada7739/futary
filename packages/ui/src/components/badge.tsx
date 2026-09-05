import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { radius } from "../tokens";

export type BadgeProps = Omit<ViewProps, "style"> & {
  children: ReactNode;
};

// ピル型のバッジ。中身（Text）は呼び出し側が組み立てる（Cardと同じくstyleを
// 受け取らない。architecture.md 7節）。いまの唯一の用途（記念日カードの
// 「会った日数」ピル）に合わせた値（035視覚仕様1節: 高さ28・
// paddingHorizontal16・地はsurface opacity 0.7。半透明はカード自体が
// 半透明地のため、呼び出し側でopacityを含む背景色を指定する）
export function Badge({ children, ...rest }: BadgeProps) {
  return (
    <View
      {...rest}
      style={{
        alignSelf: "flex-start",
        height: 28,
        paddingHorizontal: 16,
        borderRadius: radius.pill,
        backgroundColor: "rgba(255, 255, 255, 0.7)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </View>
  );
}

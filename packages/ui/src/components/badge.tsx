import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { radius } from "../tokens";

export type BadgeProps = Omit<ViewProps, "style"> & {
  children: ReactNode;
};

// ピル型のバッジ。中身（Text）は呼び出し側が組む（Card と同じく style を受け取らない。architecture.md 7節）。
// 値は記念日カードの「会った日数」に合わせる（高さ 28・横 16）。カード自体が半透明なので、
// 半透明の背景色は呼び出し側が渡す
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

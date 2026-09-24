import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { useTheme } from "../appearance";
import { radius, space, type SpaceToken } from "../tokens";

export type CardProps = Omit<ViewProps, "style"> & {
  children: ReactNode;
  // 枠線を primary にする（リリース履歴の最新の 1 枚）。ピンクの通常のカードは枠を持たないので、
  // この 1 枚だけ中身が 1px 内側へ寄る（許容）
  accent?: boolean;
  // 内側の余白（既定 lg = 16）。投稿カードは md（12）で詰める
  padding?: SpaceToken;
};

// ホワイトは影が無い（shadow.card の不透明度 0）ので border 1px で浮かせる。ピンクには足さない
// （枠線は中身を 1px 内側へ動かす。039）
export function Card({ children, accent = false, padding = "lg", ...rest }: CardProps) {
  const { appearance, colors, shadow } = useTheme();
  return (
    <View
      {...rest}
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: space[padding],
        ...(accent
          ? { borderWidth: 1, borderColor: colors.primary }
          : appearance === "white"
            ? { borderWidth: 1, borderColor: colors.border }
            : null),
        ...shadow.card,
      }}
    >
      {children}
    </View>
  );
}

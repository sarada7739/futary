import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { useTheme } from "../appearance";
import { radius, space } from "../tokens";

export type CardProps = Omit<ViewProps, "style"> & {
  children: ReactNode;
  // 043: 枠線を primary にする（リリース履歴の最新の 1 枚）。両モードで 1px。
  // ピンクの通常のカードは枠線を持たないので、この 1 枚だけ中身が 1px 内側へ寄る（許容）
  accent?: boolean;
};

// 039: ホワイトでは影が無い（shadow.card の不透明度 0）ので、border 1px の枠線で
// 浮かせる。ピンクにも 1px を足す案（分岐を1つ減らせる）はタスク定義3節に
// あるが、枠線は中身を 1px 内側へ動かすため「ピンクを1ピクセルも変えない」に
// 反する。最初から分岐する（3節「変わるなら分岐する」）
export function Card({ children, accent = false, ...rest }: CardProps) {
  const { appearance, colors, shadow } = useTheme();
  return (
    <View
      {...rest}
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: space.lg,
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

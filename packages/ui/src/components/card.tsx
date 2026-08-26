import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { colors, radius, shadow, space } from "../tokens";

export type CardProps = Omit<ViewProps, "style"> & {
  children: ReactNode;
};

export function Card({ children, ...rest }: CardProps) {
  return (
    <View
      {...rest}
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: space.lg,
        ...shadow.card,
      }}
    >
      {children}
    </View>
  );
}

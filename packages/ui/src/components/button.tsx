import type { ReactNode } from "react";
import { Pressable, type PressableProps } from "react-native";
import { colors, radius, space } from "../tokens";
import { Text } from "./text";

export type ButtonVariant = "primary" | "ghost";

export type ButtonProps = Omit<PressableProps, "style" | "children"> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

export function Button({ variant = "primary", children, ...rest }: ButtonProps) {
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => {
        if (variant === "primary") {
          return {
            backgroundColor: pressed ? colors.primaryPressed : colors.primary,
            paddingVertical: space.md,
            paddingHorizontal: space.xl,
            borderRadius: radius.pill,
            alignItems: "center",
          };
        }
        return {
          backgroundColor: pressed ? colors.surfaceTint : "transparent",
          paddingVertical: space.md,
          paddingHorizontal: space.xl,
          borderRadius: radius.pill,
          alignItems: "center",
        };
      }}
    >
      <Text
        size="md"
        weight="bold"
        color={variant === "primary" ? "inverse" : "brand"}
      >
        {children}
      </Text>
    </Pressable>
  );
}

import type { ReactNode } from "react";
import { Pressable, type PressableProps } from "react-native";
import { colors, radius, space } from "../tokens";
import { Text } from "./text";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = Omit<PressableProps, "style" | "children"> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

export function Button({ variant = "primary", disabled, children, ...rest }: ButtonProps) {
  return (
    <Pressable
      disabled={disabled}
      {...rest}
      style={({ pressed }) => {
        const base = {
          paddingVertical: space.md,
          paddingHorizontal: space.xl,
          borderRadius: radius.pill,
          alignItems: "center" as const,
        };
        if (variant === "primary") {
          return {
            ...base,
            backgroundColor: disabled
              ? colors.border
              : pressed
                ? colors.primaryPressed
                : colors.primary,
          };
        }
        if (variant === "secondary") {
          return {
            ...base,
            backgroundColor: pressed ? colors.surfaceTint : colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          };
        }
        return {
          ...base,
          backgroundColor: pressed ? colors.surfaceTint : "transparent",
        };
      }}
    >
      <Text
        size="md"
        weight="bold"
        color={disabled ? "muted" : variant === "primary" ? "inverse" : "brand"}
      >
        {children}
      </Text>
    </Pressable>
  );
}

import type { ReactNode } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../tokens";

export type ScreenProps = {
  children: ReactNode;
};

export function Screen({ children }: ScreenProps) {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={["top", "bottom"]}
    >
      {children}
    </SafeAreaView>
  );
}

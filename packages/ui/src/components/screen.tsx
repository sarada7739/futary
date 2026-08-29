import type { ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, layout } from "../tokens";

export type ScreenProps = {
  children: ReactNode;
  // 既定で layout.maxWidth に制約する（architecture.md 7節）。外す画面だけが
  // 明示的に指定する。呼び出し側にラッパーを書かせると足し忘れが起きるため、
  // 逸脱の方を差分に残す向きにしている
  unconstrained?: boolean;
};

export function Screen({ children, unconstrained = false }: ScreenProps) {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={["top", "bottom"]}
    >
      <View
        style={
          unconstrained
            ? { flex: 1 }
            : { flex: 1, width: "100%", maxWidth: layout.maxWidth, alignSelf: "center" }
        }
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

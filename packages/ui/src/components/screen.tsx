import type { ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { gradients, layout } from "../tokens";

export type ScreenProps = {
  children: ReactNode;
  // 既定で layout.maxWidth に制約する（architecture.md 7節）。外す画面だけが
  // 明示的に指定する。呼び出し側にラッパーを書かせると足し忘れが起きるため、
  // 逸脱の方を差分に残す向きにしている
  unconstrained?: boolean;
};

// 035（見た目を作り込む）: 淡いグラデーションの地。ここ1つで14画面の地が
// 変わる（タスク定義5節）
export function Screen({ children, unconstrained = false }: ScreenProps) {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
      <LinearGradient
        colors={gradients.screen}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
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

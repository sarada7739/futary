import type { ReactNode } from "react";
import { Image, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { bokeh } from "../assets";
import { colors, gradients, layout } from "../tokens";

// 035視覚仕様4節: 画面上部だけに敷く光のボケの高さ。カード（記念日カード等、
// 主役の要素）の背後に来る位置という想定
const BOKEH_HEIGHT = 420;
// ボケ画像を高さ420ptで打ち切ると、その境目に地の色との段差が見える
// （実測: y=419→420で全x位置に一貫してrgb差3〜5。Aの指摘どおり継ぎ目が
// 実在した）。下端をフェードさせて消す。フェードの高さは感覚値
const BOKEH_FADE_HEIGHT = 140;

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
      <Image
        source={bokeh}
        resizeMode="cover"
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: BOKEH_HEIGHT, opacity: 0.8 }}
      />
      {/* ボケ画像の下端をgradients.screenの2色目（surfaceTint）へフェードし、
          高さで打ち切ったことによる継ぎ目を消す */}
      <LinearGradient
        colors={["transparent", colors.surfaceTint]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          position: "absolute",
          top: BOKEH_HEIGHT - BOKEH_FADE_HEIGHT,
          left: 0,
          right: 0,
          height: BOKEH_FADE_HEIGHT,
        }}
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

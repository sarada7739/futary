import type { ReactNode } from "react";
import { Image, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { bokeh } from "../assets";
import { useTheme } from "../appearance";
import { layout } from "../tokens";

// 画面上部だけに敷く光のボケの高さ（主役のカードの背後に来る位置）。
// ボケ画像は下端 35% にアルファのランプを焼き込んである（bokeh.png）。固定色へフェードする形だと、
// 地が斜めのグラデーションなのでどこかで値がずれて継ぎ目が見える（artifacts/036/seam.md）。
// resizeMode="stretch" + width:"100%": cover だと窓幅が 1195px を超えると縦がクロップされてランプの
// 下端が切れ、width を指定しないと要素が画像の自然幅（853px）で止まって縦の段差が出る
// （artifacts/036/bokeh-dom-measurement.json）。ボケは形のある絵ではないので、横に伸びても気づかれない
const BOKEH_HEIGHT = 420;

export type ScreenProps = {
  children: ReactNode;
  // 既定で layout.maxWidth に制約する（architecture.md 7節）。外す画面だけが明示する
  // （呼び出し側にラッパーを書かせると足し忘れが起きるので、逸脱の方を差分に残す）
  unconstrained?: boolean;
};

// 淡いグラデーションの地。ここ 1 つで全画面の地が変わる（035）。
// ホワイトは地が平ら（gradients.screen の両端が同じ色）でボケを敷かない。ボケは画像の有無で値では
// 表せないので、ここだけ appearance で分岐する（039）
export function Screen({ children, unconstrained = false }: ScreenProps) {
  const { appearance, gradients } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
      <LinearGradient
        colors={gradients.screen}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {appearance === "pink" && (
        <Image
          testID="screen-bokeh"
          source={bokeh}
          resizeMode="stretch"
          style={{ position: "absolute", top: 0, left: 0, right: 0, width: "100%", height: BOKEH_HEIGHT, opacity: 0.8 }}
        />
      )}
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

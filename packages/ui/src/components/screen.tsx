import type { ReactNode } from "react";
import { Image, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { bokeh } from "../assets";
import { gradients, layout } from "../tokens";

// 035視覚仕様4節: 画面上部だけに敷く光のボケの高さ。カード（記念日カード等、
// 主役の要素）の背後に来る位置という想定。
//
// 036: 035では下端140ptを固定色（surfaceTint）へフェードする別レイヤーを
// 重ねて継ぎ目を消していたが、地が斜めのグラデーションのため、どの固定色を
// 選んでも画面上のどこかで必ず値がずれ、実機で継ぎ目が見える不具合が
// 残っていた（人間の実機報告・Aの実測で発覚。artifacts/036/seam.md）。
// 固定色へフェードするのをやめ、ボケ画像そのものの下端にアルファの
// ランプ（下35%を255→0）を焼き込んだ（packages/ui/assets/bokeh.png。
// 生成の経緯はdocs/sample/README.md）。この高さ（420）はresizeMode="cover"で
// 画像を敷いたときに縦方向のクロップが起きない値であり
// （画像853×300・420/300=1.4倍に対し横方向は853×1.4=1194>デバイス幅なので
// 横だけがクロップされる。実測で確認）、画像の下端＝アルファが0になる位置＝
// 表示上の下端が一致する。フェード先の色という概念自体が無くなったため、
// 地のグラデーションと一致しないという問題が原理的に起きない
const BOKEH_HEIGHT = 420;

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

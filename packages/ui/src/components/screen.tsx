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
// 生成の経緯はdocs/sample/README.md）。フェード先の色という概念自体が
// 無くなったため、地のグラデーションと一致しないという問題が原理的に
// 起きない。
//
// 【Rレビュー指摘・訂正】当初resizeMode="cover"で、420という値は
// 「画像853×300をcoverで高さ420の箱に敷くと縦方向はクロップされない」
// という前提のもとに選んでいたが、この前提は窓幅（＝ボケ画像の表示幅。
// layout.maxWidthの内側ではなく画面幅いっぱい）が広いデスクトップでは
// 崩れる。coverの拡大率は横方向の必要倍率と縦方向の必要倍率のうち
// 大きい方で決まり、窓幅が1195pxを超えると横方向の倍率（窓幅/853）が
// 420/300=1.4を上回り、縦方向はその倍率で拡大された上で中央がクロップ
// される。1280・1920といった通常のデスクトップ幅で焼き込んだアルファの
// ランプの下端が切り落とされ、継ぎ目が復活する（Rが倍率を計算して発見）。
// resizeMode="stretch"に変更した。箱（幅いっぱい×420）にそのまま
// 引き伸ばすため、クロップという概念自体が無くなり、窓幅に関わらず
// 画像の下端＝アルファ0の位置＝箱の下端が常に一致する。ボケは形のある
// 絵ではないため、横に伸びても見た目で気づかれない
//
// 【Rレビュー指摘・訂正2】stretchにしても、widthを指定しなければ
// 効果が無かった。resizeModeは箱の中身の収め方を決めるだけで、箱自体の
// 大きさは決めない。DOMで実測したところ（artifacts/036/
// bokeh-dom-measurement.json）、widthを指定しない状態ではleft:0/right:0
// を指定していても、背景を持つ要素自体の幅が画面幅ではなく画像の自然幅
// （853px）のままになっていた（background-sizeは正しくstretch相当の
// "100% 100%"になっていたが、要素自体が853pxしか無ければそこで終わる）。
// この結果、窓幅が853pxを超えるデスクトップで、画像の右端（x=853）に
// 地のグラデーションとの縦の段差ができていた（Rが列方向を実測して発見。
// 横の継ぎ目が消えた代わりに縦の継ぎ目が出た形）。styleにwidth:"100%"を
// 明示的に足し、DOMで背景要素の幅が画面幅と一致することを確認した
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
        resizeMode="stretch"
        style={{ position: "absolute", top: 0, left: 0, right: 0, width: "100%", height: BOKEH_HEIGHT, opacity: 0.8 }}
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

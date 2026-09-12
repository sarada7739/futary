import { Image, View } from "react-native";
import { iconFabPlus } from "../assets";
import { useTheme } from "../appearance";

export type FabIconProps = {
  size: number;
};

// 白い「＋」の腕の長さと太さ（size=56 のとき 22 と 2.5。ピンクの fab-plus.png の
// ＋とほぼ同じ見た目になる比率。B が 039 段階1で実機比較して決めた）
const PLUS_LENGTH_RATIO = 22 / 56;
const PLUS_THICKNESS_RATIO = 2.5 / 56;

// 中央の投稿ボタン（FAB）の絵。
//
// ピンクでは 008 で切り出した画像（fab-plus.png: ピンクの円に白い＋）をそのまま描く
// （039 でピンクの見た目は1ピクセルも変えない）。
//
// ホワイトでは黒い円にする（タスク定義3節: FAB は primary）。画像は円も＋も
// 不透明で、tintColor を当てると＋まで黒く塗りつぶされて消える（B が PNG の画素を
// 実測: 白 1840px・ピンク 19930px・透過 6014px、＋は透過ではない）ため、画像は
// 使わず View で描く。分岐はこの部品に閉じる（呼び出し側は appearance を読まない）
export function FabIcon({ size }: FabIconProps) {
  const { appearance, colors } = useTheme();

  if (appearance === "pink") {
    return <Image source={iconFabPlus} style={{ width: size, height: size }} resizeMode="contain" />;
  }

  const length = Math.round(size * PLUS_LENGTH_RATIO);
  const thickness = Math.max(2, Math.round(size * PLUS_THICKNESS_RATIO * 2) / 2);
  return (
    <View
      testID="fab-icon-white"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.primary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View style={{ position: "absolute", width: length, height: thickness, borderRadius: thickness / 2, backgroundColor: colors.surface }} />
      <View style={{ position: "absolute", width: thickness, height: length, borderRadius: thickness / 2, backgroundColor: colors.surface }} />
    </View>
  );
}

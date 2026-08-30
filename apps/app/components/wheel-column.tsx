import { useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { colors, Text } from "@futary/ui";

const ITEM_HEIGHT = 40;
// 奇数。中央の1行が選択行、上下に2行ずつ薄く見せる（人間が絵で指定した形）
const VISIBLE_COUNT = 5;
const PADDING_COUNT = Math.floor(VISIBLE_COUNT / 2);

export type WheelColumnProps = {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  testID?: string;
};

// 時・分どちらの列にも使う汎用コンポーネント。5分刻みに乗らない値を含む
// 任意のoptions配列を渡せる（呼び出し側がbuildMinuteOptionsで差し込む）
export function WheelColumn({ options, value, onChange, testID }: WheelColumnProps) {
  const scrollRef = useRef<ScrollView>(null);
  const selectedIndex = Math.max(0, options.indexOf(value));

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: false });
    // optionsの中身が変わる（刻みに乗らない値の出入り）とインデックスがずれるため、
    // 長さも依存に含める
  }, [selectedIndex, options.length]);

  // 確定という操作を持たない。スクロール位置から、いま中央にある行を毎回
  // そのまま値にする（022・docs/tasks/022-time-and-date-input.md「タイマーで
  // 確定しない」。Aの決定）。iPhoneはフリック後も慣性で回り続けるため、
  // タイマーで確定すると減速が終わる前に通り過ぎた値で確定してしまい、
  // かつそれは016のデプロイ後まで確かめられない（開発サーバーはiPhone実機に
  // 届かない）。画面が見せているものと保存されるものを構造として一致させ、
  // 食い違わないことを確かめずに済む形にする（「刻みに乗らない値を丸めない」
  // と同じ考え方）
  function commitFromOffset(offsetY: number) {
    const index = Math.max(0, Math.min(options.length - 1, Math.round(offsetY / ITEM_HEIGHT)));
    const next = options[index];
    if (next === undefined) return;
    // 刻みに乗らない特別行が選択肢から消えるのは、値が実際に変わった時だけ
    // （「自分で動かしたなら利用者の操作」022）
    if (next !== value) onChange(next);
  }

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    commitFromOffset(e.nativeEvent.contentOffset.y);
  }

  function selectByPress(index: number) {
    scrollRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
    onChange(options[index]!);
  }

  return (
    <View
      testID={testID}
      style={[
        { height: ITEM_HEIGHT * VISIBLE_COUNT, width: 64, overflow: "hidden" },
        // 上下を薄くする。maskImageはWebにしか無いCSSプロパティで、Safariには
        // -webkit-接頭辞が要る（022の落とし穴）。ネイティブでは効かないが、
        // 効かなくても実害はない（単に上下がフェードしないだけ）
        Platform.OS === "web"
          ? ({
              maskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
              WebkitMaskImage: "-webkit-linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
            } as object)
          : null,
      ]}
    >
      {/* 中央の選択帯。ScrollViewより先に置いて背景に回す（あとに置くとDOM順で
          前面に来て数字を覆い隠す。人間の実機確認で発覚）。
          pointerEvents="none"で下のScrollViewへのタップを妨げない */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: ITEM_HEIGHT * PADDING_COUNT,
          left: 0,
          right: 0,
          height: ITEM_HEIGHT,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.primarySubtle,
        }}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * PADDING_COUNT }}
        // CSSのscroll-snapも併用する（scrollendがあれば使う程度に留め、
        // 主な確定判定はscrollの停止で行う。react-native-webはキャメルケースの
        // CSSプロパティをstyleにそのまま渡せる）
        style={Platform.OS === "web" ? ({ scrollSnapType: "y mandatory" } as object) : undefined}
      >
        {options.map((option, index) => (
          <Pressable
            key={option}
            onPress={() => selectByPress(index)}
            testID={testID ? `${testID}-option-${option}` : undefined}
            style={[
              { height: ITEM_HEIGHT, alignItems: "center", justifyContent: "center" },
              Platform.OS === "web" ? ({ scrollSnapAlign: "center" } as object) : null,
            ]}
          >
            <Text size={option === value ? "lg" : "md"} color={option === value ? "default" : "muted"}>
              {option}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

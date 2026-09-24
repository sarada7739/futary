import { useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { Text, useTheme } from "@futary/ui";

const ITEM_HEIGHT = 40;
// 奇数。中央の 1 行が選択行で、上下に 2 行ずつ薄く見せる
const VISIBLE_COUNT = 5;
const PADDING_COUNT = Math.floor(VISIBLE_COUNT / 2);

export type WheelColumnProps = {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  testID?: string;
};

// 時・分どちらの列にも使う。刻みに乗らない値を含む任意の options を渡せる（呼び出し側が buildMinuteOptions で差し込む）
export function WheelColumn({ options, value, onChange, testID }: WheelColumnProps) {
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const selectedIndex = Math.max(0, options.indexOf(value));
  // 直前に自分から通知した value。位置合わせの scrollTo は「外から value が変わったとき」だけ走らせ、
  // 自分の onChange が一往復して戻ってきたとき（スクロール中）には走らせない。
  // 一度立てたら戻さないので「自分の値 → 別の値 → 同じ値」と往復すると誤認しうるが、event-form.tsx の
  // Modal が閉じるたびにアンマウントする前提で害が出ない（前提は event-form.tsx 側）
  const selfCommittedValueRef = useRef<string | null>(null);
  // タップで選んだ行は、確定後の最新の options で出した selectedIndex へアニメーション移動する
  // （タップ時点の index だと、刻み外れの値が消えて options が縮んだとき違う値に着地する）。
  // 次の effect で 1 回だけ移動するための予約
  const pendingAnimatedScrollRef = useRef(false);

  useEffect(() => {
    if (selfCommittedValueRef.current === value) {
      if (pendingAnimatedScrollRef.current) {
        pendingAnimatedScrollRef.current = false;
        scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: true });
      }
      return;
    }
    scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: false });
    // options の中身が変わる（刻みに乗らない値の出入り）と index がずれるので、長さも依存に含める
  }, [value, selectedIndex, options.length]);

  // 確定の操作を持たず、中央にある行を毎回そのまま値にする。タイマーで確定すると、iPhone の慣性で
  // 通り過ぎた値で確定しうる。見せているものと保存されるものを構造で一致させる（022）。
  // ただし scrollTo を毎回走らせると、スクロール中に物理位置を上書きして戦うので、
  // 自分が動かした結果の value では位置を戻さない
  function commit(next: string) {
    selfCommittedValueRef.current = next;
    onChange(next);
  }

  function commitFromOffset(offsetY: number) {
    const index = Math.max(0, Math.min(options.length - 1, Math.round(offsetY / ITEM_HEIGHT)));
    const next = options[index];
    if (next === undefined) return;
    // 刻みに乗らない行が消えるのは値が実際に変わったときだけ（自分で動かしたなら利用者の操作）
    if (next !== value) commit(next);
  }

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    commitFromOffset(e.nativeEvent.contentOffset.y);
  }

  function selectByPress(index: number) {
    const next = options[index]!;
    if (next === value) {
      // 値も options も変わらないので、タップ時点の index へそのまま移動してよい
      scrollRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
      return;
    }
    // options が確定後の値で伸び縮みしうるので、飛び先は再描画後の effect に任せる
    pendingAnimatedScrollRef.current = true;
    commit(next);
  }

  return (
    <View
      testID={testID}
      style={[
        { height: ITEM_HEIGHT * VISIBLE_COUNT, width: 64, overflow: "hidden" },
        // 上下を薄くする。maskImage は Web だけの CSS で、Safari には -webkit- が要る（ネイティブでは効かないだけ）
        Platform.OS === "web"
          ? ({
              maskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
              WebkitMaskImage: "-webkit-linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
            } as object)
          : null,
      ]}
    >
      {/* 中央の選択帯。ScrollView より先に置いて背景に回す（後に置くと DOM 順で前面に来て数字を覆う）。
          pointerEvents="none" で下のタップを妨げない */}
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
        testID={testID ? `${testID}-scroll` : undefined}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * PADDING_COUNT }}
        // CSS の scroll-snap も併用して行の境界で吸着させる（react-native-web はキャメルケースの CSS をそのまま渡せる）
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

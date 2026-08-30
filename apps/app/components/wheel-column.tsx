import { useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { colors, Text } from "@futary/ui";

const ITEM_HEIGHT = 40;
// 奇数。中央の1行が選択行、上下に2行ずつ薄く見せる（人間が絵で指定した形）
const VISIBLE_COUNT = 5;
const PADDING_COUNT = Math.floor(VISIBLE_COUNT / 2);

// Safari（デスクトップ・iOSとも）にscrollendが無いため、scrollが一定時間
// 止まったところを確定として拾う（022・docs/tasks/022-time-and-date-input.md）。
// iOSの慣性スクロールは長く続くため、短くするとPCのホイールに合わせた値では
// iPhoneだけ「指を離した瞬間の値」になってしまう（Rレビュー指摘）
const SETTLE_DELAY_MS = 300;

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
  // 開いた直後・値が外から変わった直後のscrollToは利用者の操作ではないため
  // 確定させない（Rレビュー指摘）。このフラグが立っている間はscrollハンドラの
  // 確定処理を無視する
  const isInitializingRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedIndex = Math.max(0, options.indexOf(value));

  useEffect(() => {
    isInitializingRef.current = true;
    scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: false });
    // scrollToが起こすscrollイベントがこのフラグを見る前に飛んでこないよう、
    // 少し待ってから解除する
    const timer = setTimeout(() => {
      isInitializingRef.current = false;
    }, 50);
    return () => clearTimeout(timer);
    // optionsの中身が変わる（刻みに乗らない値の出入り）とインデックスがずれるため、
    // 長さも依存に含める
  }, [selectedIndex, options.length]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function commit(offsetY: number) {
    const index = Math.max(0, Math.min(options.length - 1, Math.round(offsetY / ITEM_HEIGHT)));
    const next = options[index];
    if (next === undefined) return;
    // 利用者が動かした結果として選ぶ。刻みに乗らない特別行が選択肢から
    // 消えるのはここを通った時だけ（「自分で動かしたなら利用者の操作」022）
    if (next !== value) onChange(next);
    scrollRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
  }

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (isInitializingRef.current) return;
    const offsetY = e.nativeEvent.contentOffset.y;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(offsetY), SETTLE_DELAY_MS);
  }

  function selectByPress(index: number) {
    isInitializingRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
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

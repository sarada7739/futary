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
  // 直前にcommit()で自分から通知したvalueを覚えておく。位置合わせの
  // scrollToは「外からvalueが変わったとき」だけ走らせ、自分のonChangeが
  // 一往復して戻ってきたとき（利用者がスクロール中）には走らせない
  // （Rの指摘・Aの決定。PR #156レビュー）。selfCommittedValueRefは一度
  // 立てたら戻さない。マウント中に「自分の値→別の値→また同じ値」と往復
  // すると、その最後の外部変化を自分由来と誤認して位置がずれる余地がある。
  // このコンポーネントを使うevent-form.tsxのModalが`animationType="none"`
  // で閉じるたびアンマウントする前提で害が出ないようにしている
  // （前提が崩れる条件はevent-form.tsx側のコメント参照）
  const selfCommittedValueRef = useRef<string | null>(null);
  // タップ（selectByPress）できた行の位置合わせだけは、確定後の最新optionsで
  // 出したselectedIndexへアニメーション移動したい（タップ時点のindexで
  // 飛び先を決めると、刻み外れ値が消えてoptionsが縮んだ場合にアニメーション
  // 終点がずれたoptionsを読んでしまい違う値に着地する。Rの指摘）。
  // 次のeffectで1回だけアニメーション移動するよう予約するフラグ
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
    // optionsの中身が変わる（刻みに乗らない値の出入り）とインデックスがずれるため、
    // 長さも依存に含める
  }, [value, selectedIndex, options.length]);

  // 確定という操作を持たない。スクロール位置から、いま中央にある行を毎回
  // そのまま値にする（022・docs/tasks/022-time-and-date-input.md「タイマーで
  // 確定しない」。Aの決定）。iPhoneはフリック後も慣性で回り続けるため、
  // タイマーで確定すると減速が終わる前に通り過ぎた値で確定してしまい、
  // かつそれは016のデプロイ後まで確かめられない（開発サーバーはiPhone実機に
  // 届かない）。画面が見せているものと保存されるものを構造として一致させ、
  // 食い違わないことを確かめずに済む形にする（「刻みに乗らない値を丸めない」
  // と同じ考え方）。ただし位置合わせのscrollToを毎回走らせると、利用者が
  // スクロールしている最中（慣性の途中・刻み外れ値が選択肢から消えて
  // indexが繰り上がる瞬間）に、実際の物理位置を上書きして戦ってしまう
  // （Rの指摘）。そこで「自分が動かした結果のvalueでは位置を戻さない」形にした
  function commit(next: string) {
    selfCommittedValueRef.current = next;
    onChange(next);
  }

  function commitFromOffset(offsetY: number) {
    const index = Math.max(0, Math.min(options.length - 1, Math.round(offsetY / ITEM_HEIGHT)));
    const next = options[index];
    if (next === undefined) return;
    // 刻みに乗らない特別行が選択肢から消えるのは、値が実際に変わった時だけ
    // （「自分で動かしたなら利用者の操作」022）
    if (next !== value) commit(next);
  }

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    commitFromOffset(e.nativeEvent.contentOffset.y);
  }

  function selectByPress(index: number) {
    const next = options[index]!;
    if (next === value) {
      // 値は変わらない（optionsも変わらない）ので、タップ時点のindexへ
      // そのままアニメーション移動してよい
      scrollRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
      return;
    }
    // optionsが確定後の値に基づいて縮む/伸びる可能性があるため、飛び先は
    // ここでは決めず、再レンダー後のeffectに委ねる
    pendingAnimatedScrollRef.current = true;
    commit(next);
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
        testID={testID ? `${testID}-scroll` : undefined}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * PADDING_COUNT }}
        // CSSのscroll-snapも併用する（行の境界で吸着させ見た目を揃える。
        // react-native-webはキャメルケースのCSSプロパティをstyleにそのまま渡せる）
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

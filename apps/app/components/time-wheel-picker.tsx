import { View } from "react-native";
import { space, Text } from "@futary/ui";
import { buildMinuteOptions, HOUR_OPTIONS, joinTime, splitTime } from "../lib/time-wheel";
import { WheelColumn } from "./wheel-column";

export type TimeWheelPickerProps = {
  // HH:MM。呼び出し側が必ず値を持たせる（未設定の切り替えはボタン側の責務。
  // 022「開始を選ぶ前に終了を選べない形にする」）
  value: string;
  onChange: (value: string) => void;
  testID?: string;
};

// 時・分の2列。中央に選択帯を置き、上下は薄くする（人間が絵で指定した形）。
// 分は5分刻みだが、刻みに乗らない既存の値は消さず選択肢へ差し込む（022）
export function TimeWheelPicker({ value, onChange, testID }: TimeWheelPickerProps) {
  const { hour, minute } = splitTime(value);
  const minuteOptions = buildMinuteOptions(minute);

  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <WheelColumn
        options={HOUR_OPTIONS}
        value={hour}
        onChange={(nextHour) => onChange(joinTime(nextHour, minute))}
        testID={testID ? `${testID}-hour` : undefined}
      />
      <Text size="lg" weight="bold">
        :
      </Text>
      <WheelColumn
        options={minuteOptions}
        value={minute}
        onChange={(nextMinute) => onChange(joinTime(hour, nextMinute))}
        testID={testID ? `${testID}-minute` : undefined}
      />
    </View>
  );
}

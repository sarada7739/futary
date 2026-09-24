import { View } from "react-native";
import { space, Text } from "@futary/ui";
import { buildMinuteOptions, HOUR_OPTIONS, joinTime, splitTime } from "../lib/time-wheel";
import { WheelColumn } from "./wheel-column";

export type TimeWheelPickerProps = {
  // HH:MM。呼び出し側が必ず値を持たせる（未設定との切り替えはボタンの側）
  value: string;
  onChange: (value: string) => void;
  testID?: string;
};

// 時・分の 2 列。中央に選択帯、上下は薄く。分は 5 分刻みだが、刻みに乗らない既存の値は選択肢へ差し込む
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

import { useEffect, useRef, useState } from "react";
import { TextInput } from "react-native";
import { colors, radius, space } from "@futary/ui";
import { digitsToDate, digitsToDisplay, toDigits } from "../lib/date-input8";

export type DateInput8Props = {
  // "" または YYYY-MM-DD。8桁そろって実在する日付になったときだけonChangeで
  // YYYY-MM-DDを渡す。それ以外（入力途中・存在しない日付）は""を渡す
  value: string;
  onChange: (value: string) => void;
  testID?: string;
};

// 数字8桁を YYYY-MM-DD に変換する入力（022 B）。区切りは打たせず、
// 8桁そろうまでは日付として扱わない
export function DateInput8({ value, onChange, testID }: DateInput8Props) {
  const [digits, setDigits] = useState(() => toDigits(value));
  // 自分がonChangeで通知した値は、親から折り返ってきても入力中の桁を
  // 壊さない（8桁未満の間は親には""しか渡らないため、親のvalueだけでは
  // 入力途中を復元できない）。外部から明示的に値が変わったとき
  // （マイページの初回ロード等）だけ内部状態を合わせる
  const lastEmittedRef = useRef(value);
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setDigits(toDigits(value));
      lastEmittedRef.current = value;
    }
  }, [value]);

  function handleChangeText(text: string) {
    const nextDigits = toDigits(text);
    setDigits(nextDigits);
    const nextValue = digitsToDate(nextDigits);
    lastEmittedRef.current = nextValue;
    onChange(nextValue);
  }

  return (
    <TextInput
      value={digitsToDisplay(digits)}
      onChangeText={handleChangeText}
      placeholder="YYYYMMDD"
      placeholderTextColor={colors.textMuted}
      keyboardType="number-pad"
      testID={testID}
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.input,
        padding: space.md,
        fontSize: 16,
        color: colors.text,
      }}
    />
  );
}

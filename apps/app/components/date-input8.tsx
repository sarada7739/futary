import { useEffect, useRef, useState } from "react";
import { TextInput } from "react-native";
import { radius, space, useTheme } from "@futary/ui";
import { digitsToDate, digitsToDisplay, toDigits } from "../lib/date-input8";

export type DateInput8Props = {
  // "" または YYYY-MM-DD。8 桁そろって実在する日付のときだけ YYYY-MM-DD を渡し、それ以外は ""
  value: string;
  onChange: (value: string) => void;
  testID?: string;
};

// 数字 8 桁を YYYY-MM-DD にする入力（022）。区切りは打たせず、8 桁そろうまでは日付として扱わない
export function DateInput8({ value, onChange, testID }: DateInput8Props) {
  const { colors } = useTheme();
  const [digits, setDigits] = useState(() => toDigits(value));
  // 自分が通知した値が親から折り返ってきても、入力中の桁を壊さない（8 桁未満の間は親に "" しか渡らないので、
  // 親の value だけでは入力途中を戻せない）。外から値が変わったとき（初回のロード等）だけ合わせる
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

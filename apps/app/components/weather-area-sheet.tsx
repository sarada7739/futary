import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { WEATHER_AREAS, WEATHER_PREFECTURES } from "@futary/contract";
import { Button, radius, space, Text, useTheme } from "@futary/ui";
import { Sheet } from "./sheet";

// マイページの「天気の地域」のシート（058）。都道府県 → 予報区の 2 段（表は契約に同梱で、API に取りに行かない）。
// 予報区が 1 つの県は押した時点で決まる。「設定しない」で null（位置情報は取らない）

export type WeatherAreaSheetProps = {
  visible: boolean;
  // 今の地域（無ければ null）
  current: string | null;
  onClose: () => void;
  onSelect: (areaCode: string | null) => void;
};

export function WeatherAreaSheet({ visible, current, onClose, onSelect }: WeatherAreaSheetProps) {
  const { colors } = useTheme();
  // 2 段目（予報区が複数の県を押したとき）。null なら 1 段目
  const [prefecture, setPrefecture] = useState<string | null>(null);
  const pref = prefecture === null ? null : (WEATHER_PREFECTURES.find((p) => p.name === prefecture) ?? null);

  function close() {
    setPrefecture(null);
    onClose();
  }
  function pick(code: string | null) {
    setPrefecture(null);
    onSelect(code);
  }

  const rowStyle = (selected: boolean) =>
    ({
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      borderRadius: radius.input,
      backgroundColor: selected ? colors.primarySubtle : "transparent",
    }) as const;

  return (
    <Sheet visible={visible} onClose={close} title={pref ? pref.name : "天気の地域"}>
      <View style={{ gap: space.sm, maxHeight: 420 }} testID="weather-area-sheet">
        {pref === null && (
          <Text size="xs" color="muted">
            都道府県を選ぶと、カレンダーに 7 日先までの天気が出ます。位置情報は取得しません
          </Text>
        )}
        <ScrollView style={{ maxHeight: 320 }}>
          {pref === null
            ? WEATHER_PREFECTURES.map((p) => {
                const selected = current !== null && p.areas.includes(current);
                return (
                  <Pressable
                    key={p.name}
                    accessibilityRole="button"
                    testID={`weather-pref-${p.name}`}
                    onPress={() => (p.areas.length === 1 ? pick(p.areas[0]!) : setPrefecture(p.name))}
                    style={rowStyle(selected)}
                  >
                    <Text>{p.areas.length === 1 ? p.name : `${p.name} ›`}</Text>
                  </Pressable>
                );
              })
            : pref.areas.map((code) => (
                <Pressable
                  key={code}
                  accessibilityRole="button"
                  testID={`weather-area-${code}`}
                  onPress={() => pick(code)}
                  style={rowStyle(current === code)}
                >
                  <Text>{WEATHER_AREAS[code]?.name ?? code}</Text>
                </Pressable>
              ))}
        </ScrollView>
        {pref !== null ? (
          <Button variant="ghost" onPress={() => setPrefecture(null)} testID="weather-area-back">
            ‹ 都道府県に戻る
          </Button>
        ) : (
          <Button variant="ghost" onPress={() => pick(null)} testID="weather-area-none">
            設定しない
          </Button>
        )}
      </View>
    </Sheet>
  );
}

import { View } from "react-native";
import { radius, space, Text, useTheme } from "@futary/ui";
import { buildMonthGrid, WEEKDAY_LABELS } from "../lib/calendar";
import { MOOD_LABELS } from "../lib/mood-labels";

const CELL_WIDTH = `${100 / 7}%`;

// タスク定義2節: 新しい色トークンを作らない。primaryの濃さ5段は不透明度から
// ここで導出する（役割ではなく量だから、architecture.md 7節のトークンには
// しない）
const LEVEL_ALPHAS: Record<number, number> = { 1: 0.2, 2: 0.4, 3: 0.6, 4: 0.8, 5: 1 };

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

// 039: primary は外観で変わるため、RGB への分解は描画時に行う（モジュール直下の
// 定数にしない）
function backgroundFor(level: number | undefined, primary: { r: number; g: number; b: number }): string {
  if (level === undefined) return "transparent";
  return `rgba(${primary.r}, ${primary.g}, ${primary.b}, ${LEVEL_ALPHAS[level]})`;
}

export type MoodMonthGridProps = {
  year: number;
  month: number; // 1-12
  levelsByDate: Record<string, number>;
  todayDate: string;
};

export function MoodMonthGrid({ year, month, levelsByDate, todayDate }: MoodMonthGridProps) {
  const { colors } = useTheme();
  const primaryRgb = hexToRgb(colors.primary);
  const days = buildMonthGrid(year, month);

  return (
    <View>
      <View style={{ flexDirection: "row" }}>
        {WEEKDAY_LABELS.map((label) => (
          <View key={label} style={{ width: CELL_WIDTH, alignItems: "center", paddingVertical: space.xs }}>
            <Text size="xs" color="muted">
              {label}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {days.map((day) => {
          const level = levelsByDate[day.date];
          // タスク定義2節「未記録は、地のまま枠線だけ」。薄い色（level 1）と
          // 未記録を見間違えないよう、色の濃さではなく枠線の有無で分ける
          const isRecorded = level !== undefined;
          const isToday = day.date === todayDate;
          const dayNumber = Number(day.date.slice(8, 10));

          return (
            <View
              key={day.date}
              accessible
              accessibilityLabel={`${day.date}: ${isRecorded ? MOOD_LABELS[level] : "未記録"}`}
              style={{
                width: CELL_WIDTH,
                aspectRatio: 1,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.input,
                backgroundColor: backgroundFor(level, primaryRgb),
                borderWidth: isRecorded ? 0 : 1,
                borderColor: colors.border,
                opacity: day.inMonth ? 1 : 0.35,
              }}
            >
              <Text
                size="sm"
                weight={isToday ? "bold" : "regular"}
                color={isRecorded && level >= 4 ? "inverse" : isToday ? "brand" : "default"}
              >
                {dayNumber}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

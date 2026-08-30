import { Pressable, Text as RNText, View } from "react-native";
import type { Event } from "@futary/contract";
import { colors, radius, space, Text } from "@futary/ui";
import { buildMonthGrid, WEEKDAY_LABELS } from "../lib/calendar";
import { EVENT_KIND_COLORS, EVENT_KIND_GLYPHS, type EventKind } from "../lib/event-kind";

const CELL_WIDTH = `${100 / 7}%`;

export type MonthGridProps = {
  year: number;
  month: number; // 1-12
  // 日付ごとのイベント。読み込み中は空のオブジェクトを渡す
  // （グリッドの骨格は常に出し、マーカーだけ遅延させる。タスク011「状態の網羅」）
  eventsByDate: Record<string, Event[]>;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  todayDate: string;
};

function kindsOf(events: Event[] | undefined): EventKind[] {
  if (!events || events.length === 0) return [];
  const seen = new Set<EventKind>();
  for (const event of events) seen.add(event.kind);
  return Array.from(seen);
}

export function MonthGrid({ year, month, eventsByDate, selectedDate, onSelectDate, todayDate }: MonthGridProps) {
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
          const isSelected = day.date === selectedDate;
          const isToday = day.date === todayDate;
          const kinds = kindsOf(eventsByDate[day.date]);
          const dayNumber = Number(day.date.slice(8, 10));

          return (
            <Pressable
              key={day.date}
              onPress={() => onSelectDate(day.date)}
              testID={`calendar-day-${day.date}`}
              accessibilityRole="button"
              accessibilityLabel={day.date}
              style={{
                width: CELL_WIDTH,
                aspectRatio: 1,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.input,
                backgroundColor: isSelected ? colors.primarySubtle : "transparent",
              }}
            >
              <Text
                size="sm"
                weight={isToday ? "bold" : "regular"}
                color={!day.inMonth ? "muted" : isToday ? "brand" : "default"}
              >
                {dayNumber}
              </Text>
              <View style={{ flexDirection: "row", gap: 2, minHeight: 10 }}>
                {kinds.map((kind) => (
                  <RNText key={kind} style={{ color: EVENT_KIND_COLORS[kind], fontSize: 8 }}>
                    {EVENT_KIND_GLYPHS[kind]}
                  </RNText>
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

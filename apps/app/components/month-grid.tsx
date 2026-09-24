import { Pressable, Text as RNText, View } from "react-native";
import type { Event, WeatherDay } from "@futary/contract";
import { radius, space, Text, useTheme, WeatherIcon } from "@futary/ui";
import { tempMaxLabel } from "../lib/weather";
import { buildMonthGrid, WEEKDAY_LABELS } from "../lib/calendar";
import { eventKindColorsOf, EVENT_KIND_GLYPHS, type EventKind } from "../lib/event-kind";

const CELL_WIDTH = `${100 / 7}%`;
// マスの中の天気の絵（マスは 390 幅で 50px 弱。058）
const WEATHER_CELL_ICON = 20;
const CELL_MIN_HEIGHT = 56;

export type MonthGridProps = {
  year: number;
  month: number; // 1-12
  // 日付ごとのイベント。読み込み中は空のオブジェクト（骨格は常に出し、マーカーだけ遅らせる）
  eventsByDate: Record<string, Event[]>;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  todayDate: string;
  // 日付ごとの天気（今日から 7 日。無ければ空）。絵 + 最高気温を数字の下に出す
  weatherByDate?: Record<string, WeatherDay>;
  // 祝日（日付 → 名前）。日付を記念日と同じ赤に
  holidays?: Record<string, string>;
};

function kindsOf(events: Event[] | undefined): EventKind[] {
  if (!events || events.length === 0) return [];
  const seen = new Set<EventKind>();
  for (const event of events) seen.add(event.kind);
  return Array.from(seen);
}

export function MonthGrid({ year, month, eventsByDate, selectedDate, onSelectDate, todayDate, weatherByDate = {}, holidays = {} }: MonthGridProps) {
  const { colors } = useTheme();
  const eventKindColors = eventKindColorsOf(colors);
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
          const weather = weatherByDate[day.date];
          const isHoliday = holidays[day.date] !== undefined;

          return (
            <Pressable
              key={day.date}
              onPress={() => onSelectDate(day.date)}
              testID={`calendar-day-${day.date}`}
              accessibilityRole="button"
              accessibilityLabel={day.date}
              style={{
                width: CELL_WIDTH,
                // 天気の絵 + 気温が入るので、正方形でなく最小の高さ
                minHeight: CELL_MIN_HEIGHT,
                paddingVertical: 2,
                alignItems: "center",
                justifyContent: "flex-start",
                borderRadius: radius.input,
                backgroundColor: isSelected ? colors.primarySubtle : "transparent",
              }}
            >
              {/* 祝日は記念日と同じ赤（日曜と同じ扱い）。今日・月の外の色より優先しない */}
              {isHoliday && day.inMonth && !isToday ? (
                <RNText testID={`calendar-holiday-${day.date}`} style={{ color: colors.eventAnniversary, fontSize: 14, lineHeight: 20 }}>
                  {dayNumber}
                </RNText>
              ) : (
                <Text
                  size="sm"
                  weight={isToday ? "bold" : "regular"}
                  color={!day.inMonth ? "muted" : isToday ? "brand" : "default"}
                >
                  {dayNumber}
                </Text>
              )}
              {/* 天気（今日から 7 日）。数字の上に被せない。絵 + 最高気温だけ */}
              {weather && (
                <View testID={`calendar-weather-${day.date}`} style={{ alignItems: "center", gap: 1 }}>
                  <WeatherIcon code={weather.code} size={WEATHER_CELL_ICON} />
                  <RNText style={{ color: colors.textMuted, fontSize: 9, lineHeight: 11 }}>{tempMaxLabel(weather)}</RNText>
                </View>
              )}
              <View style={{ flexDirection: "row", gap: 2, minHeight: 10 }}>
                {kinds.map((kind) => (
                  <RNText key={kind} style={{ color: eventKindColors[kind], fontSize: 8 }}>
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

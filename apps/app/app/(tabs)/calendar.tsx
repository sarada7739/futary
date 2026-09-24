import { useEffect, useMemo, useState } from "react";
import { Pressable, Text as RNText, ScrollView, View } from "react-native";
import type { Event, WeatherDay } from "@futary/contract";
import { addMonths, todayJst } from "@futary/date";
import { Button, Card, radius, Screen, space, Text, useTheme, WeatherIcon, weatherIconsOf } from "@futary/ui";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { EventForm, type EventFormValues } from "../../components/event-form";
import { MonthGrid } from "../../components/month-grid";
import { monthGridRange, monthLabel } from "../../lib/calendar";
import { eventKindColorsOf, EVENT_KIND_GLYPHS, EVENT_KIND_LABELS, EVENT_KIND_ORDER } from "../../lib/event-kind";
import { formatEventTimeRange } from "../../lib/event-time";
import { useGuestMode } from "../../lib/guest-mode";
import { orpc } from "../../lib/orpc";
import { queryClient } from "../../lib/query";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";
import { dismissWeatherPrompt, isWeatherPromptDismissed, isWithinWeatherDays, weatherByDateOf, weatherDayLabel } from "../../lib/weather";

type FormState = { mode: "create" | "edit"; date: string; event?: Event };

function weatherNameOf(code: string): string {
  return weatherIconsOf(code).name;
}

function groupByDate(events: Event[]): Record<string, Event[]> {
  const result: Record<string, Event[]> = {};
  for (const event of events) {
    (result[event.date] ??= []).push(event);
  }
  return result;
}

// 会った日は 1 日 1 件。event.date（会った日は繰り返さないので sourceDate と同じ）をキーにする
function meetupByDateOf(events: Event[]): Record<string, Event> {
  const result: Record<string, Event> = {};
  for (const event of events) {
    if (event.kind === "meetup") result[event.date] = event;
  }
  return result;
}

// 時間・設定者の有無で行の高さが変わらないよう、既存の 2 行（タイトル・メタ）に収める。
// canEdit が false の行は Pressable にしない（押せてから断られる形にしない。相手の予定は押せない形で見せる）
function EventRow({ event, onPress }: { event: Event; onPress: () => void }) {
  const { colors } = useTheme();
  const eventKindColors = eventKindColorsOf(colors);
  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs }}>
      <RNText style={{ color: eventKindColors[event.kind], fontSize: 14 }}>
        {EVENT_KIND_GLYPHS[event.kind]}
      </RNText>
      <View style={{ flex: 1 }}>
        <Text>
          {event.startTime ? `${formatEventTimeRange(event)} ` : ""}
          {event.title}
        </Text>
        <Text size="xs" color="muted">
          {EVENT_KIND_LABELS[event.kind]}
          {event.repeatYearly ? "・毎年" : ""}
          {event.createdByName ? `・${event.createdByName}が設定` : ""}
          {/* canEdit:false はデモ閲覧者（全種別）でも起きる。「編集は設定者のみ」は plan にしか当てはまらない
              理由なので、記念日・会った日には出さない */}
          {event.kind === "plan" && !event.canEdit ? "・編集は設定者のみ" : ""}
        </Text>
      </View>
    </View>
  );

  if (!event.canEdit) {
    return <View testID={`event-row-${event.id}-${event.date}`}>{content}</View>;
  }

  return (
    <Pressable onPress={onPress} testID={`event-row-${event.id}-${event.date}`}>
      {content}
    </Pressable>
  );
}

type ForDate = { mine: WeatherEntry | null; partner: WeatherEntry | null; same: boolean };
type WeatherEntry = { area: { code: string; name: string }; day: WeatherDay | null };

// ふたりの地域が同じか、片方だけ設定なら 1 行（地域名: 天気）。違えば 2 行（058）
function WeatherRows({ result }: { result: ForDate }) {
  const twoLines = !result.same && result.mine !== null && result.partner !== null;
  const entries: { label: string; entry: WeatherEntry }[] = twoLines
    ? [
        { label: `自分（${result.mine!.area.name}）`, entry: result.mine! },
        { label: `相手（${result.partner!.area.name}）`, entry: result.partner! },
      ]
    : result.mine
      ? [{ label: result.mine.area.name, entry: result.mine }]
      : result.partner
        ? [{ label: result.partner.area.name, entry: result.partner }]
        : [];
  if (entries.length === 0) return null;
  return (
    <View style={{ gap: space.xs, paddingTop: space.xs }} testID="calendar-weather-rows">
      {entries.map(({ label, entry }, i) => (
        <View key={`${i}-${entry.area.code}`} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }} testID={`calendar-weather-row-${i}`}>
          {entry.day ? <WeatherIcon code={entry.day.code} size={22} /> : null}
          <Text size="sm" color="muted">
            {entry.day ? `${label}: ${weatherDayLabel(weatherNameOf(entry.day.code), entry.day)}` : `${label}: 予報がありません`}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function CalendarScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const eventKindColors = eventKindColorsOf(colors);
  const { isGuestMode, exitGuestMode } = useGuestMode();
  const todayDate = useMemo(() => todayJst(), []);
  const [year, setYear] = useState(() => Number(todayDate.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(todayDate.slice(5, 7)));
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const range = useMemo(() => monthGridRange(year, month), [year, month]);

  // queryKey に viewerKey を含める（lib/viewer-key.ts。T9）
  const viewerKey = useViewerQueryKey();
  const eventListOptions = orpc.event.list.queryOptions({ input: range });
  const query = useQuery({ ...eventListOptions, queryKey: [...eventListOptions.queryKey, viewerKey] });

  // 天気（自分の地域。今日から 7 日）・祝日（表示中の年）・「天気の地域を選ぶ ›」の帯（058）
  const weatherOptions = orpc.weather.get.queryOptions({ input: {} });
  const weatherQuery = useQuery({ ...weatherOptions, queryKey: [...weatherOptions.queryKey, viewerKey] });
  const holidayOptions = orpc.holiday.list.queryOptions({ input: { year } });
  const holidayQuery = useQuery({ ...holidayOptions, queryKey: [...holidayOptions.queryKey, viewerKey] });
  const weatherByDate = useMemo(() => weatherByDateOf(weatherQuery.data?.days ?? []), [weatherQuery.data]);
  const holidays = holidayQuery.data?.holidays ?? {};
  // 地域が未設定のときだけ。× で消したら端末に記憶（描いたあとに読む。静的書き出しでは window が無い）
  const [weatherPromptDismissed, setWeatherPromptDismissed] = useState(true);
  useEffect(() => {
    setWeatherPromptDismissed(isWeatherPromptDismissed());
  }, []);
  const showWeatherPrompt = !isGuestMode && weatherQuery.data !== undefined && weatherQuery.data.area === null && !weatherPromptDismissed;
  // 選んだ日の天気（7 日以内だけ）
  const selectedWithinWeather = isWithinWeatherDays(selectedDate, todayDate);
  const forDateOptions = orpc.weather.getForDate.queryOptions({ input: { date: selectedDate } });
  const forDateQuery = useQuery({
    ...forDateOptions,
    queryKey: [...forDateOptions.queryKey, viewerKey],
    enabled: selectedWithinWeather,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.event.list.key() });
  const createEvent = useMutation(orpc.event.create.mutationOptions({ onSuccess: invalidate }));
  const updateEvent = useMutation(orpc.event.update.mutationOptions({ onSuccess: invalidate }));
  const deleteEvent = useMutation(orpc.event.delete.mutationOptions({ onSuccess: invalidate }));

  const events = query.data?.items ?? [];
  const eventsByDate = useMemo(() => groupByDate(events), [events]);
  const meetupByDate = useMemo(() => meetupByDateOf(events), [events]);
  const selectedDayEvents = eventsByDate[selectedDate] ?? [];
  const isSubmitting = createEvent.isPending || updateEvent.isPending;

  function goToMonth(delta: number) {
    const next = addMonths(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
    setSelectedDate(`${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}-01`);
  }

  function openCreateForm() {
    // デモ閲覧中は登録できないので、フォームを開かずログインの導線に替える
    if (isGuestMode) {
      exitGuestMode();
      return;
    }
    setFormError(null);
    setFormState({ mode: "create", date: selectedDate });
  }

  function openEditForm(event: Event) {
    setFormError(null);
    // 射影された日付でなく登録された日付（sourceDate）を編集する（event.date だと、表示中の年に記念日
    // そのものを動かしてしまう）
    setFormState({ mode: "edit", date: event.sourceDate, event });
  }

  async function handleSubmit(values: EventFormValues) {
    setFormError(null);
    try {
      if (formState?.mode === "edit" && formState.event) {
        await updateEvent.mutateAsync({ id: formState.event.id, ...values });
      } else {
        await createEvent.mutateAsync(values);
      }
      setFormState(null);
    } catch (error) {
      // update の INVALID_INPUT は、その日に別の「会った日」があるときだけ返る（create は上書きなので来ない）。
      // catch の error（unknown）では isDefinedError が never に潰れるので instanceof で見る
      if (error instanceof ORPCError && error.code === "INVALID_INPUT") {
        setFormError("その日には既に「会った日」が登録されています。日付を変えてください");
      } else {
        setFormError("保存できませんでした。もう一度お試しください");
      }
    }
  }

  async function handleDelete() {
    if (!(formState?.mode === "edit" && formState.event)) return;
    setFormError(null);
    try {
      await deleteEvent.mutateAsync({ id: formState.event.id });
      setFormState(null);
    } catch {
      setFormError("削除できませんでした。もう一度お試しください");
    }
  }

  const editingEvent = formState?.mode === "edit" ? formState.event : undefined;
  const sourceDateNote =
    editingEvent && editingEvent.sourceDate !== editingEvent.date
      ? `この記念日は ${editingEvent.sourceDate} に登録されています。日付を変えると登録日そのものが変わります`
      : undefined;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable onPress={() => goToMonth(-1)} accessibilityRole="button" accessibilityLabel="前月" hitSlop={space.md}>
            <Text size="lg">‹ 前月</Text>
          </Pressable>
          <Text size="lg" weight="bold">
            {monthLabel(year, month)}
          </Text>
          <Pressable onPress={() => goToMonth(1)} accessibilityRole="button" accessibilityLabel="翌月" hitSlop={space.md}>
            <Text size="lg">翌月 ›</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
          {EVENT_KIND_ORDER.map((kind) => (
            <View key={kind} style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
              <RNText style={{ color: eventKindColors[kind], fontSize: 12 }}>{EVENT_KIND_GLYPHS[kind]}</RNText>
              <Text size="xs" color="muted">
                {EVENT_KIND_LABELS[kind]}
              </Text>
            </View>
          ))}
        </View>

        {query.isError && !query.data ? (
          <View style={{ alignItems: "center", gap: space.md, padding: space.xl }}>
            <Text color="muted">カレンダーを読み込めませんでした</Text>
            <Button
              variant="secondary"
              onPress={async () => {
                await query.refetch();
              }}
            >
              再試行
            </Button>
          </View>
        ) : (
          <>
            {/* 読み込み中もグリッドの骨格は出したまま、マーカーだけ空で遅らせる */}
            {showWeatherPrompt && (
              <View
                testID="weather-prompt"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: space.sm,
                  paddingVertical: space.xs,
                  paddingHorizontal: space.md,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surfaceTint,
                }}
              >
                <Pressable accessibilityRole="button" onPress={() => router.push("/profile")} hitSlop={space.sm} testID="weather-prompt-link">
                  <Text size="xs" color="brand" weight="medium">
                    天気の地域を選ぶ ›
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="閉じる"
                  onPress={() => {
                    dismissWeatherPrompt();
                    setWeatherPromptDismissed(true);
                  }}
                  hitSlop={space.sm}
                  testID="weather-prompt-close"
                >
                  <Text size="xs" color="muted">
                    ×
                  </Text>
                </Pressable>
              </View>
            )}

            <MonthGrid
              year={year}
              month={month}
              eventsByDate={eventsByDate}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              todayDate={todayDate}
              weatherByDate={weatherByDate}
              holidays={holidays}
            />

            {!query.isLoading && events.length === 0 && (
              <Text color="muted">予定はまだありません</Text>
            )}

            <Card>
              <View style={{ gap: space.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text weight="bold">{selectedDate}</Text>
                  <Button variant="ghost" onPress={openCreateForm} testID="calendar-add-event">
                    {isGuestMode ? "ログインして追加" : "＋ 追加"}
                  </Button>
                </View>

                {/* 祝日の名前は一覧の一番上（予定ではないので押せない） */}
                {holidays[selectedDate] !== undefined && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs }} testID="calendar-holiday-name">
                    <RNText style={{ color: colors.eventAnniversary, fontSize: 14 }}>●</RNText>
                    <Text>{holidays[selectedDate]}</Text>
                  </View>
                )}

                {selectedDayEvents.length === 0 ? (
                  <Text size="sm" color="muted">
                    この日の予定はありません
                  </Text>
                ) : (
                  selectedDayEvents.map((event) => (
                    <EventRow key={`${event.id}-${event.date}`} event={event} onPress={() => openEditForm(event)} />
                  ))
                )}

                {/* 7 日以内の日なら「天気」の行（予定が無い日も「この日の予定はありません」の下に出す）。
                    地域が同じか片方だけなら 1 行、違えば 2 行 */}
                {selectedWithinWeather && forDateQuery.data && <WeatherRows result={forDateQuery.data} />}
              </View>
            </Card>
          </>
        )}
      </ScrollView>

      <EventForm
        visible={formState !== null}
        mode={formState?.mode ?? "create"}
        defaultDate={formState?.date ?? selectedDate}
        defaultTitle={editingEvent?.title}
        defaultKind={editingEvent?.kind}
        defaultStartTime={editingEvent?.startTime}
        defaultEndTime={editingEvent?.endTime}
        defaultIsShared={editingEvent?.isShared}
        sourceDateNote={sourceDateNote}
        meetupByDate={meetupByDate}
        editingEventId={editingEvent?.id}
        isSubmitting={isSubmitting}
        errorMessage={formError}
        onSubmit={handleSubmit}
        onDelete={formState?.mode === "edit" ? handleDelete : undefined}
        onCancel={() => setFormState(null)}
      />
    </Screen>
  );
}

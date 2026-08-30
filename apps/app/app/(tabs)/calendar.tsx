import { useMemo, useState } from "react";
import { Pressable, Text as RNText, ScrollView, View } from "react-native";
import type { Event } from "@futary/contract";
import { addMonths, todayJst } from "@futary/date";
import { Button, Card, Screen, space, Text } from "@futary/ui";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EventForm, type EventFormValues } from "../../components/event-form";
import { MonthGrid } from "../../components/month-grid";
import { monthGridRange, monthLabel } from "../../lib/calendar";
import { EVENT_KIND_COLORS, EVENT_KIND_GLYPHS, EVENT_KIND_LABELS, EVENT_KIND_ORDER } from "../../lib/event-kind";
import { formatEventTimeRange } from "../../lib/event-time";
import { useGuestMode } from "../../lib/guest-mode";
import { orpc } from "../../lib/orpc";
import { queryClient } from "../../lib/query";

type FormState = { mode: "create" | "edit"; date: string; event?: Event };

function groupByDate(events: Event[]): Record<string, Event[]> {
  const result: Record<string, Event[]> = {};
  for (const event of events) {
    (result[event.date] ??= []).push(event);
  }
  return result;
}

// kind='meetup' は1日1件（018）。event.date（=sourceDate。meetupは繰り返さない）を
// キーにする。EventFormの上書き注記に使う
function meetupByDateOf(events: Event[]): Record<string, Event> {
  const result: Record<string, Event> = {};
  for (const event of events) {
    if (event.kind === "meetup") result[event.date] = event;
  }
  return result;
}

// 時間・設定者の有無で行の高さが変わらないようにする。どちらも既存の2行
// （タイトル行・メタ行）の中に収める形にし、行を増やさない（018確認観点）。
// 021: canEditがfalseの行はPressableにしない（押せてから断られる形にしない。
// 相手の予定が編集できないことが画面から分かるよう、構造的に押せない形にする。
// 017の「次フェーズ」パネルと同じ考え方）
function EventRow({ event, onPress }: { event: Event; onPress: () => void }) {
  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs }}>
      <RNText style={{ color: EVENT_KIND_COLORS[event.kind], fontSize: 14 }}>
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
          {/* canEdit:falseは「共有でないplanの非設定者」だけでなく、未認証の
              デモ閲覧者（全kind）でも起きる。「編集は設定者のみ」はplanにしか
              当てはまらない理由なので、記念日・会った日には出さない
              （security-auditor指摘） */}
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

export default function CalendarScreen() {
  const { isGuestMode, exitGuestMode } = useGuestMode();
  const todayDate = useMemo(() => todayJst(), []);
  const [year, setYear] = useState(() => Number(todayDate.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(todayDate.slice(5, 7)));
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const range = useMemo(() => monthGridRange(year, month), [year, month]);

  const query = useQuery(orpc.event.list.queryOptions({ input: range }));

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
    // 014: デモ閲覧中は登録できない（サーバ側でFORBIDDENになる）ため、
    // フォームを開かせずログイン導線に差し替える
    if (isGuestMode) {
      exitGuestMode();
      return;
    }
    setFormError(null);
    setFormState({ mode: "create", date: selectedDate });
  }

  function openEditForm(event: Event) {
    setFormError(null);
    // 射影された日付ではなく、登録された日付（sourceDate）を編集対象にする。
    // ここを event.date にすると、射影で表示されている年に記念日そのものを
    // 動かしてしまう（architecture.md 5節の射影とは別物）
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
      // event.update の INVALID_INPUT は events_meetup_unique 違反（＝その日には
      // 既に別の「会った日」がある）のときだけ返る（018・apps/api/src/procedures/event.ts）。
      // create はここに来ない（ON CONFLICT DO UPDATE で上書きするため）。
      // isDefinedError は catch 節の error（unknown）だと型が never に潰れて絞り込めない
      // ため、ORPCError の instanceof で判定する
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
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
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
              <RNText style={{ color: EVENT_KIND_COLORS[kind], fontSize: 12 }}>{EVENT_KIND_GLYPHS[kind]}</RNText>
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
            {/* 読み込み中もグリッドの骨格は出したまま、マーカーだけ空で遅延させる
                （eventsByDate が空のオブジェクトのまま渡る。タスク011「状態の網羅」） */}
            <MonthGrid
              year={year}
              month={month}
              eventsByDate={eventsByDate}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              todayDate={todayDate}
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

                {selectedDayEvents.length === 0 ? (
                  <Text size="sm" color="muted">
                    この日の予定はありません
                  </Text>
                ) : (
                  selectedDayEvents.map((event) => (
                    <EventRow key={`${event.id}-${event.date}`} event={event} onPress={() => openEditForm(event)} />
                  ))
                )}
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

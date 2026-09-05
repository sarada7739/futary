import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { addMonths, todayJst } from "@futary/date";
import { Button, Card, Screen, space, Text } from "@futary/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MoodMonthGrid } from "../../components/mood-month-grid";
import { monthGridRange, monthLabel } from "../../lib/calendar";
import { useGuestMode } from "../../lib/guest-mode";
import { MOOD_LABELS, MOOD_LEVELS } from "../../lib/mood-labels";
import { orpc } from "../../lib/orpc";
import { queryClient } from "../../lib/query";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

function levelsOf(items: { date: string; level: number }[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) result[item.date] = item.level;
  return result;
}

// 020のホーム機能パネル「気分の記録」の行き先。ボトムタブには出さない
// （027・list.tsxと同じ扱い）
export default function MoodScreen() {
  const { isGuestMode, exitGuestMode } = useGuestMode();
  const todayDate = useMemo(() => todayJst(), []);
  const [year, setYear] = useState(() => Number(todayDate.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(todayDate.slice(5, 7)));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const range = useMemo(() => monthGridRange(year, month), [year, month]);
  // 今日の選択ボタンは、月グリッドをどの月に動かしても常に「今日」を指す
  // 必要があるため、月の範囲とは別にtodayDateだけの範囲で問い合わせる
  const todayRange = useMemo(() => ({ from: todayDate, to: todayDate }), [todayDate]);

  // queryKeyにviewerKeyを含める理由はapps/app/lib/viewer-key.ts参照（T9）
  const viewerKey = useViewerQueryKey();
  const monthOptions = orpc.mood.list.queryOptions({ input: range });
  const monthQuery = useQuery({ ...monthOptions, queryKey: [...monthOptions.queryKey, viewerKey] });
  const todayOptions = orpc.mood.list.queryOptions({ input: todayRange });
  const todayQuery = useQuery({ ...todayOptions, queryKey: [...todayOptions.queryKey, viewerKey] });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.mood.list.key() });
  const setToday = useMutation(orpc.mood.setToday.mutationOptions({ onSuccess: invalidate }));
  const clearToday = useMutation(orpc.mood.clearToday.mutationOptions({ onSuccess: invalidate }));

  const myTodayLevel = todayQuery.data?.mine[0]?.level;
  const mineByDate = useMemo(() => levelsOf(monthQuery.data?.mine ?? []), [monthQuery.data]);
  const partner = monthQuery.data?.partner ?? null;
  const partnerByDate = useMemo(() => levelsOf(partner?.items ?? []), [partner]);
  const isMutating = setToday.isPending || clearToday.isPending;

  function goToMonth(delta: number) {
    const next = addMonths(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
  }

  // もう一度押すと取り消す（タスク定義11節）
  async function handleSelect(level: number) {
    setErrorMessage(null);
    try {
      if (myTodayLevel === level) {
        await clearToday.mutateAsync(undefined);
      } else {
        await setToday.mutateAsync({ level });
      }
    } catch {
      setErrorMessage("記録できませんでした。もう一度お試しください");
    }
  }

  const bothEmpty = Object.keys(mineByDate).length === 0 && Object.keys(partnerByDate).length === 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.md }}>
        <Card>
          <View style={{ gap: space.sm }}>
            <Text weight="bold">今日の気分</Text>
            {isGuestMode ? (
              // 014の導線に合わせる。押してからサーバに拒まれる形にしない
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text color="muted">記録はログインすると使えます</Text>
                <Button variant="ghost" onPress={exitGuestMode}>
                  ログイン
                </Button>
              </View>
            ) : (
              <>
                <View style={{ flexDirection: "row", gap: space.xs }}>
                  {MOOD_LEVELS.map((level) => (
                    <View key={level} style={{ flex: 1 }}>
                      <Button
                        variant={myTodayLevel === level ? "primary" : "secondary"}
                        disabled={isMutating}
                        onPress={() => handleSelect(level)}
                        accessibilityLabel={MOOD_LABELS[level]}
                      >
                        {String(level)}
                      </Button>
                    </View>
                  ))}
                </View>
                {/* 色だけで区別しない。選んだ段階を言葉でも出す（タスク定義2節） */}
                <Text color="muted">
                  今日: {myTodayLevel !== undefined ? MOOD_LABELS[myTodayLevel] : "まだ記録していません"}
                </Text>
              </>
            )}
            {errorMessage && <Text color="muted">{errorMessage}</Text>}
          </View>
        </Card>

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

        {monthQuery.isLoading ? (
          <View style={{ alignItems: "center", padding: space.xl }}>
            <Text color="muted">読み込み中…</Text>
          </View>
        ) : monthQuery.isError && !monthQuery.data ? (
          <View style={{ alignItems: "center", gap: space.md, padding: space.xl }}>
            <Text color="muted">読み込めませんでした</Text>
            <Button
              variant="secondary"
              onPress={async () => {
                await monthQuery.refetch();
              }}
            >
              再試行
            </Button>
          </View>
        ) : (
          <View style={{ gap: space.lg }}>
            {bothEmpty && <Text color="muted">この月の記録はまだありません</Text>}

            <View style={{ gap: space.xs }}>
              <Text weight="bold">わたし</Text>
              <MoodMonthGrid year={year} month={month} levelsByDate={mineByDate} todayDate={todayDate} />
            </View>

            {/* 相手が未参加（ペアが1人）のときは相手の段を出さない（タスク定義11節） */}
            {partner && (
              <View style={{ gap: space.xs }}>
                <Text weight="bold">{partner.name ?? "相手"}</Text>
                <MoodMonthGrid year={year} month={month} levelsByDate={partnerByDate} todayDate={todayDate} />
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

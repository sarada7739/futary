import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { addDays, addMonths, isoWeekKey, todayJst } from "@futary/date";
import { Button, Card, Screen, space, Text } from "@futary/ui";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { monthLabel } from "../../lib/calendar";
import { useGuestMode } from "../../lib/guest-mode";
import { orpc } from "../../lib/orpc";
import { queryClient } from "../../lib/query";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

function monthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

type PeriodKind = "month" | "week";

// 037タスク定義4節: 週次を足した（人間の指示。当初「まず月次だけ」だったが
// 実測ではなくAの見立てだったため訂正した）。週の計算はpackages/dateに
// 集約し、ここでは計算しない（architecture.md 5節）。前週・翌週は7日ずらす
// だけでよい（1週間=7日は暦によらず不変のため、月をまたぐ加減算のような
// 特別扱いが要らない）
export default function AiSummaryScreen() {
  const router = useRouter();
  const { isGuestMode, exitGuestMode } = useGuestMode();

  const [periodKind, setPeriodKind] = useState<PeriodKind>("month");
  // 既定は先月・先週（タスク定義9節「今月・今週はまだ終わっていない」）
  const [{ year, month }, setYearMonth] = useState(() => {
    const today = todayJst();
    return addMonths(Number(today.slice(0, 4)), Number(today.slice(5, 7)), -1);
  });
  const [weekRefDate, setWeekRefDate] = useState(() => addDays(todayJst(), -7));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const periodKey = useMemo(
    () => (periodKind === "month" ? monthKey(year, month) : isoWeekKey(weekRefDate)),
    [periodKind, year, month, weekRefDate],
  );

  // queryKeyにviewerKeyを含める理由はapps/app/lib/viewer-key.ts参照（T9）
  const viewerKey = useViewerQueryKey();
  const meOptions = orpc.me.get.queryOptions();
  const meQuery = useQuery({ ...meOptions, queryKey: [...meOptions.queryKey, viewerKey] });
  const summaryOptions = orpc.aiSummary.get.queryOptions({ input: { periodKind, periodKey } });
  const summaryQuery = useQuery({ ...summaryOptions, queryKey: [...summaryOptions.queryKey, viewerKey] });

  const generate = useMutation(
    orpc.aiSummary.generate.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.aiSummary.get.key() }),
    }),
  );

  function selectKind(kind: PeriodKind) {
    setErrorMessage(null);
    setPeriodKind(kind);
  }

  function goToPeriod(delta: number) {
    setErrorMessage(null);
    if (periodKind === "month") {
      setYearMonth((current) => addMonths(current.year, current.month, delta));
    } else {
      setWeekRefDate((current) => addDays(current, delta * 7));
    }
  }

  async function handleGenerate() {
    setErrorMessage(null);
    try {
      await generate.mutateAsync({ periodKind, periodKey });
    } catch (error) {
      const periodLabel = periodKind === "month" ? "月" : "週";
      if (error instanceof ORPCError && error.code === "INVALID_INPUT") {
        setErrorMessage(`この${periodLabel}はまだ投稿が3件に届いていません`);
      } else if (error instanceof ORPCError && error.code === "LIMIT_REACHED") {
        setErrorMessage("もう作り直せません（期間ごと3回・1ヶ月合計10回まで）");
      } else if (error instanceof ORPCError && error.code === "FORBIDDEN") {
        setErrorMessage("2人とも同意していないと使えません");
      } else {
        setErrorMessage("作れませんでした。もう一度お試しください");
      }
    }
  }

  const aiOptIn = meQuery.data?.aiOptIn ?? false;
  const partnerAiOptIn = meQuery.data?.partnerAiOptIn ?? false;
  const bothOptedIn = aiOptIn && partnerAiOptIn;
  const summary = summaryQuery.data ?? null;
  const usedUp = (summary?.generatedCount ?? 0) >= 3;
  const periodLabel = periodKind === "month" ? "月" : "週";

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.lg }}>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button variant={periodKind === "month" ? "primary" : "secondary"} onPress={() => selectKind("month")}>
              月
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button variant={periodKind === "week" ? "primary" : "secondary"} onPress={() => selectKind("week")}>
              週
            </Button>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable
            onPress={() => goToPeriod(-1)}
            accessibilityRole="button"
            accessibilityLabel={`前${periodLabel}`}
            hitSlop={space.md}
          >
            <Text size="lg">‹ 前{periodLabel}</Text>
          </Pressable>
          <Text size="lg" weight="bold">
            {periodKind === "month" ? monthLabel(year, month) : periodKey}
          </Text>
          <Pressable
            onPress={() => goToPeriod(1)}
            accessibilityRole="button"
            accessibilityLabel={`翌${periodLabel}`}
            hitSlop={space.md}
          >
            <Text size="lg">翌{periodLabel} ›</Text>
          </Pressable>
        </View>

        {summaryQuery.isLoading ? (
          <View style={{ alignItems: "center", padding: space.xl }}>
            <Text color="muted">読み込み中…</Text>
          </View>
        ) : summaryQuery.isError && summaryQuery.data === undefined ? (
          <View style={{ alignItems: "center", gap: space.md, padding: space.xl }}>
            <Text color="muted">読み込めませんでした</Text>
            <Button
              variant="secondary"
              onPress={async () => {
                await summaryQuery.refetch();
              }}
            >
              再試行
            </Button>
          </View>
        ) : (
          <Card>
            <View style={{ gap: space.md }}>
              {isGuestMode ? (
                // 014の導線に合わせる（ゲストは生成できない。サーバ側でも拒む）
                <>
                  {summary ? (
                    // タスク定義10節: デモはシードのまとめ（実際には生成していない）
                    <Text>{summary.body}</Text>
                  ) : (
                    <Text color="muted">この{periodLabel}のまとめはまだありません</Text>
                  )}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text color="muted">まとめを作るにはログインしてください</Text>
                    <Button variant="ghost" onPress={exitGuestMode}>
                      ログイン
                    </Button>
                  </View>
                </>
              ) : summary ? (
                <>
                  {/* タスク定義8節: 出力を信用しない。リンク化・マークダウン解釈を
                      しない。素のテキストとしてそのまま出す */}
                  <Text>{summary.body}</Text>
                  <Text size="xs" color="muted">
                    {summary.provider} / {summary.model}
                  </Text>
                  {!bothOptedIn ? (
                    <Text size="sm" color="muted">
                      相手の同意を待っています
                    </Text>
                  ) : usedUp ? (
                    <Text size="sm" color="muted">
                      この{periodLabel}は3回使い切りました
                    </Text>
                  ) : (
                    <Button variant="secondary" onPress={handleGenerate} disabled={generate.isPending}>
                      {generate.isPending ? "作り直しています…" : "作り直す"}
                    </Button>
                  )}
                </>
              ) : !aiOptIn ? (
                <>
                  <Text color="muted">
                    AIまとめを使うには、マイページで同意してください。投稿の本文が外部の生成AIに送られます
                  </Text>
                  <Button variant="secondary" onPress={() => router.push("/profile")}>
                    マイページへ
                  </Button>
                </>
              ) : !partnerAiOptIn ? (
                <Text color="muted">相手の同意を待っています</Text>
              ) : (
                <>
                  <Text color="muted">この{periodLabel}のまとめはまだありません</Text>
                  <Button onPress={handleGenerate} disabled={generate.isPending}>
                    {generate.isPending ? "作っています…" : "まとめを作る"}
                  </Button>
                </>
              )}
              {errorMessage && (
                <Text size="sm" color="muted">
                  {errorMessage}
                </Text>
              )}
            </View>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

import { Card, Screen, space, Text } from "@futary/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { daysTogetherLabel } from "../../lib/stats";
import { orpc } from "../../lib/orpc";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text color="muted">{label}</Text>
      <Text weight="bold">{value}</Text>
    </View>
  );
}

// 020: 012の統計カードが持っていた4つの数字を、ホームから独立したページで
// すべて出す（ホームの記念日カードはそのうち2つ〈記念日・会った日数〉の要約）。
// primary_date='none'（hidden）のときは記念日の行だけを出さず3つになる
// （4つ全部は書けない。stats.getがdaysを返さないため。Aの決定・PR #126）。
// 023: unset（まだ決めていない）も同じく3つだが、マイページへの導線を足す
// （hiddenは本人が隠すと決めたので何も促さない。同じ分け方をホームの
// 記念日カードとも揃える。docs/tasks/023-anniversary-optional.md 4節）
export default function StatsScreen() {
  const router = useRouter();
  // queryKeyにviewerKeyを含める理由はapps/app/lib/viewer-key.ts参照（T9）
  const viewerKey = useViewerQueryKey();
  const query = useQuery({
    ...orpc.stats.get.queryOptions(),
    queryKey: [...orpc.stats.get.queryOptions().queryKey, viewerKey],
  });

  if (query.isError) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>
          <Text color="muted">統計を読み込めませんでした</Text>
        </View>
      </Screen>
    );
  }

  if (query.isLoading || !query.data) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text color="muted">―</Text>
        </View>
      </Screen>
    );
  }

  const stats = query.data;
  const label = daysTogetherLabel(stats.daysTogether);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE }}>
        <Card>
          <View style={{ gap: space.md }}>
            {label && <StatRow label="記念日" value={label} />}
            {stats.daysTogether.status === "unset" && (
              <Pressable onPress={() => router.push("/profile")} testID="stats-screen-set-dating-date">
                <Text size="sm" color="brand">
                  付き合った日を設定する
                </Text>
              </Pressable>
            )}
            <StatRow label="会った日数" value={`${stats.meetupDays}日`} />
            <StatRow label="投稿数" value={`${stats.postCount}件`} />
            <StatRow label="写真の枚数" value={`${stats.photoCount}枚`} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

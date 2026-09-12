import { Card, radius, Screen, space, statsHeroPlaceholder, Text, useTheme } from "@futary/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, View } from "react-native";
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

// 039 段階2-f（ホワイト）: 行は gap ではなく区切り線で分ける（モックの統計）。
// 最後の行には線を引かない
function WhiteStatRows({ children }: { children: React.ReactNode[] }) {
  const { colors } = useTheme();
  const rows = children.filter(Boolean);
  return (
    <View testID="stats-white-rows">
      {rows.map((row, index) => (
        <View
          key={index}
          style={{
            paddingVertical: space.md,
            borderBottomWidth: index < rows.length - 1 ? 1 : 0,
            borderBottomColor: colors.border,
          }}
        >
          {row}
        </View>
      ))}
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
  // 039 段階2-f: 画面ファイルで appearance を読んでよい2箇所のうちの1つ（統計の
  // ヒーロー。もう1つはホームのロゴ）。タスク定義 5-2「分岐は部品の中に閉じる」
  const { appearance } = useTheme();
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

  const rows = [
    label ? <StatRow key="anniversary" label="記念日" value={label} /> : null,
    stats.daysTogether.status === "unset" ? (
      <Pressable key="set" onPress={() => router.push("/profile")} testID="stats-screen-set-dating-date">
        <Text size="sm" color="brand">
          付き合った日を設定する
        </Text>
      </Pressable>
    ) : null,
    <StatRow key="meetup" label="会った日数" value={`${stats.meetupDays}日`} />,
    <StatRow key="posts" label="投稿数" value={`${stats.postCount}件`} />,
    <StatRow key="photos" label="写真の枚数" value={`${stats.photoCount}枚`} />,
  ];

  // 039 段階2-f: ホワイトはモックの統計の形。上にヒーロー写真（角丸・幅いっぱい・4:3）、
  // その下に小さく muted で「統計」、大きく bold で「統計」（二段の見出し。この形は
  // モックの統計にしか無く、他画面には足さない。タスク定義 5-2 g・A の判断）。
  // ヒーロー写真は仮（docs/sample/風景 の1枚。packages/ui/src/assets.ts のコメント参照）
  if (appearance === "white") {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.lg }}>
          {/* 4:3 の箱は View で作る（react-native-web の Image に直接 aspectRatio を
              当てると効かず、縦長に伸びた。B が実機で確認。機能パネルのタイルと同じ形） */}
          <View style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radius.card, overflow: "hidden" }}>
            <Image
              testID="stats-hero"
              source={statsHeroPlaceholder}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          </View>
          <View style={{ gap: space.xs }}>
            <Text size="sm" color="muted">
              統計
            </Text>
            <Text size="xl" weight="bold">
              統計
            </Text>
          </View>
          <Card>
            <WhiteStatRows>{rows}</WhiteStatRows>
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE }}>
        <Card>
          <View style={{ gap: space.md }}>{rows}</View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

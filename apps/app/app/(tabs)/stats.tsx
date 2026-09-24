import { Card, radius, Screen, space, statsHeroPlaceholder, Text, useTheme } from "@futary/ui";
import { useQuery } from "@tanstack/react-query";
import { Tabs, useRouter } from "expo-router";
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

// ホワイトは行を gap でなく区切り線で分ける（最後の行には引かない。039）
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

// 統計の 4 つの数字を全部出す（ホームの記念日カードはその 2 つの要約。020）。
// hidden（本人が隠すと決めた）は記念日の行を出さず 3 つ。unset（まだ決めていない）も 3 つだが、マイページへの
// 導線を足す（hidden には何も促さない。ホームの記念日カードと揃える。023）
export default function StatsScreen() {
  const router = useRouter();
  // 画面で appearance を読んでよい唯一の箇所（統計のヒーロー。039）
  const { appearance } = useTheme();
  // queryKey に viewerKey を含める（lib/viewer-key.ts。T9）
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

  // ホワイトは上にヒーロー写真（角丸・幅いっぱい・4:3）、その下に muted の小さい「統計」と bold の大きい
  // 「統計」（二段の見出しはこの画面だけ）。写真は仮（assets.ts）
  if (appearance === "white") {
    return (
      <Screen>
        {/* ホワイトでは Tabs のヘッダ「統計」+ 二段見出しで「統計」が 3 回並ぶので、ホワイトのときだけヘッダごと
            消す（題を空にするだけだと空の帯が約 65pt 残る。戻るボタンは無い画面）。ピンクは変えない */}
        <Tabs.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.lg }}>
          {/* 4:3 の箱は View で作る（react-native-web の Image に aspectRatio を当てると効かず縦に伸びる） */}
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

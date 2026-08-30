import {
  iconPanelAi,
  iconPanelList,
  iconPanelMemory,
  iconPanelMood,
  iconPanelStats,
  iconPanelToday,
  iconTabCalendar,
  iconTabTimeline,
  logoMark,
  Screen,
  space,
} from "@futary/ui";
import { useRouter } from "expo-router";
import { Image, ScrollView, View } from "react-native";
import { FeaturePanel } from "../../components/feature-panel";
import { StatsCard } from "../../components/stats-card";

const LOGO_WIDTH = 96;
const LOGO_HEIGHT = 34;

// 020: ホームを投稿一覧（タイムラインへ独立）から、状態を見て各機能へ入る画面へ
// 変えた。並び順は上から: ロゴ → 記念日カード（ふたりのアバター・記念日・
// 会った日数。stats-card.tsxがこの2つをまとめて持つ） → 機能パネル。
// 014のデモで最初に出る画面でもある
export default function HomeScreen() {
  const router = useRouter();

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <Image source={logoMark} style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }} resizeMode="contain" />

        <StatsCard />

        {/* パネルは常に出す。データの取得に失敗しても入口が消えてはいけない
            （タスク定義「状態の網羅」）。取得状態に依存しないため、
            StatsCardのようにquery状態を気にする必要が無い。
            4列×2行のグリッド（PR #132。モックアップの4+3の空き1枠を
            タイムラインが埋める） */}
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <FeaturePanel label="タイムライン" icon={iconTabTimeline} onPress={() => router.push("/timeline")} />
          <FeaturePanel label="カレンダー" icon={iconTabCalendar} onPress={() => router.push("/calendar")} />
          <FeaturePanel label="思い出" icon={iconPanelMemory} onPress={() => router.push("/memory")} />
          <FeaturePanel label="統計" icon={iconPanelStats} onPress={() => router.push("/stats")} />
          <FeaturePanel label="今日どうだった？" icon={iconPanelToday} />
          <FeaturePanel label="リスト" icon={iconPanelList} />
          <FeaturePanel label="気分の記録" icon={iconPanelMood} />
          <FeaturePanel label="AIまとめ" icon={iconPanelAi} />
        </View>
      </ScrollView>
    </Screen>
  );
}

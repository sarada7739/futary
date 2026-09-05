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
import { useState } from "react";
import { Image, ScrollView, View } from "react-native";
import { FeaturePanel } from "../../components/feature-panel";
import { StatsCard } from "../../components/stats-card";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";

const LOGO_WIDTH = 96;
const LOGO_HEIGHT = 34;

const PANEL_COLUMNS = 4;
const PANEL_COLUMN_GAP = 10;

// 020: ホームを投稿一覧（タイムラインへ独立）から、状態を見て各機能へ入る画面へ
// 変えた。並び順は上から: ロゴ → 記念日カード（ふたりのアバター・記念日・
// 会った日数。stats-card.tsxがこの2つをまとめて持つ） → 機能パネル。
// 014のデモで最初に出る画面でもある
export default function HomeScreen() {
  const router = useRouter();
  // react-native-webはcolumnGapと"25%"のようなパーセント幅を併用しても
  // 幅を自動で詰め直さない（4列×25%+3個ぶんのgapがコンテナ幅を超え、
  // 4列目が折り返して3列になる不具合を実測で発見した。035）。実測した幅から
  // pxで算出してFeaturePanelへ渡す
  const [panelGridWidth, setPanelGridWidth] = useState(0);
  const panelWidth =
    panelGridWidth > 0
      ? (panelGridWidth - PANEL_COLUMN_GAP * (PANEL_COLUMNS - 1)) / PANEL_COLUMNS
      : undefined;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.lg,
          // 035視覚仕様3節: 機能パネルのグリッドに合わせ横余白を20に
          paddingHorizontal: 20,
          paddingBottom: TAB_BAR_CLEARANCE,
          gap: space.md,
        }}
      >
        <Image source={logoMark} style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }} resizeMode="contain" />

        <StatsCard />

        {/* パネルは常に出す。データの取得に失敗しても入口が消えてはいけない
            （タスク定義「状態の網羅」）。取得状態に依存しないため、
            StatsCardのようにquery状態を気にする必要が無い。
            4列×2行のグリッド（PR #132。モックアップの4+3の空き1枠を
            タイムラインが埋める） */}
        <View
          onLayout={(e) => setPanelGridWidth(e.nativeEvent.layout.width)}
          style={{ flexDirection: "row", flexWrap: "wrap", columnGap: PANEL_COLUMN_GAP, rowGap: 12 }}
        >
          <FeaturePanel
            label="タイムライン"
            icon={iconTabTimeline}
            onPress={() => router.push("/timeline")}
            width={panelWidth}
          />
          <FeaturePanel
            label="カレンダー"
            icon={iconTabCalendar}
            onPress={() => router.push("/calendar")}
            width={panelWidth}
          />
          <FeaturePanel
            label="思い出"
            icon={iconPanelMemory}
            onPress={() => router.push("/memory")}
            width={panelWidth}
          />
          <FeaturePanel label="統計" icon={iconPanelStats} onPress={() => router.push("/stats")} width={panelWidth} />
          <FeaturePanel label="今日どうだった？" icon={iconPanelToday} width={panelWidth} />
          <FeaturePanel label="リスト" icon={iconPanelList} onPress={() => router.push("/list")} width={panelWidth} />
          <FeaturePanel
            label="気分の記録"
            icon={iconPanelMood}
            onPress={() => router.push("/mood")}
            width={panelWidth}
          />
          <FeaturePanel label="AIまとめ" icon={iconPanelAi} width={panelWidth} />
        </View>
      </ScrollView>
    </Screen>
  );
}

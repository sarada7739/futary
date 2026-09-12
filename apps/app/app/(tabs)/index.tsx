import {
  fontFamily,
  iconPanelAi,
  iconPanelList,
  iconPanelMemory,
  iconPanelMood,
  iconPanelStats,
  iconPanelToday,
  iconTabCalendar,
  iconTabTimeline,
  logoMark,
  panelPhotoAi,
  panelPhotoCalendar,
  panelPhotoList,
  panelPhotoMemory,
  panelPhotoMood,
  panelPhotoStats,
  panelPhotoTimeline,
  panelPhotoToday,
  Screen,
  space,
  useTheme,
} from "@futary/ui";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Image, ScrollView, Text as RNText, View } from "react-native";
import { FeaturePanel } from "../../components/feature-panel";
import { StatsCard } from "../../components/stats-card";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";

const LOGO_WIDTH = 96;
const LOGO_HEIGHT = 34;

// 039 段階2-a: ホワイトのロゴは画像ではなく文字（モックの細いジオメトリック欧文）。
// Poppins 300。大きさ・字間は B がモックと並べて決めた: モックのロゴは画面幅の約 27%
// （853px 中 230px）で、390pt の画面なら幅 105pt。Poppins 300 の "futary" 6文字が
// 幅 105 になるのは 40pt 前後。字間はモックどおりわずかに開ける（0.5）。
// 行の高さ 48 は画像ロゴ（34）より 14 高いが、モックでもロゴ行は大きい
const LOGO_TEXT_SIZE = 40;
const LOGO_TEXT_LINE_HEIGHT = 48;
const LOGO_TEXT_LETTER_SPACING = 0.5;

const PANEL_COLUMNS = 4;
const PANEL_COLUMN_GAP = 10;

// 020: ホームを投稿一覧（タイムラインへ独立）から、状態を見て各機能へ入る画面へ
// 変えた。並び順は上から: ロゴ → 記念日カード（ふたりのアバター・記念日・
// 会った日数。stats-card.tsxがこの2つをまとめて持つ） → 機能パネル。
// 014のデモで最初に出る画面でもある
export default function HomeScreen() {
  const router = useRouter();
  // 039 段階2-a: 画面ファイルで appearance を読んでよい2箇所のうちの1つ（ホームのロゴ。
  // もう1つは統計のヒーロー）。タスク定義 5-2「分岐は部品の中に閉じる」
  const { appearance, colors } = useTheme();
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
        {appearance === "white" ? (
          <RNText
            testID="home-logo-text"
            accessibilityRole="header"
            style={{
              fontFamily: fontFamily.numeric,
              fontSize: LOGO_TEXT_SIZE,
              lineHeight: LOGO_TEXT_LINE_HEIGHT,
              fontWeight: "300",
              letterSpacing: LOGO_TEXT_LETTER_SPACING,
              color: colors.text,
            }}
          >
            futary
          </RNText>
        ) : (
          <Image
            testID="home-logo-image"
            source={logoMark}
            style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
            resizeMode="contain"
          />
        )}

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
            photo={panelPhotoTimeline}
            onPress={() => router.push("/timeline")}
            width={panelWidth}
          />
          <FeaturePanel
            label="カレンダー"
            icon={iconTabCalendar}
            photo={panelPhotoCalendar}
            onPress={() => router.push("/calendar")}
            width={panelWidth}
          />
          <FeaturePanel
            label="思い出"
            icon={iconPanelMemory}
            photo={panelPhotoMemory}
            onPress={() => router.push("/memory")}
            width={panelWidth}
          />
          <FeaturePanel label="統計" icon={iconPanelStats}
            photo={panelPhotoStats} onPress={() => router.push("/stats")} width={panelWidth} />
          <FeaturePanel label="今日どうだった？" icon={iconPanelToday}
            photo={panelPhotoToday} width={panelWidth} />
          <FeaturePanel label="リスト" icon={iconPanelList}
            photo={panelPhotoList} onPress={() => router.push("/list")} width={panelWidth} />
          <FeaturePanel
            label="気分の記録"
            icon={iconPanelMood}
            photo={panelPhotoMood}
            onPress={() => router.push("/mood")}
            width={panelWidth}
          />
          <FeaturePanel
            label="AIまとめ"
            icon={iconPanelAi}
            photo={panelPhotoAi}
            onPress={() => router.push("/ai-summary")}
            width={panelWidth}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

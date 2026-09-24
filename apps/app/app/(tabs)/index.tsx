import {
  iconPanelAi,
  iconPanelAlbum,
  iconPanelList,
  iconPanelMemory,
  iconPanelMood,
  iconPanelStats,
  iconPanelWant,
  iconTabCalendar,
  iconTabTimeline,
  logoMark,
  panelPhotoAi,
  panelPhotoAlbum,
  panelPhotoCalendar,
  panelPhotoList,
  panelPhotoMemory,
  panelPhotoMood,
  panelPhotoStats,
  panelPhotoTimeline,
  panelPhotoWant,
  Screen,
  space,
} from "@futary/ui";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, ScrollView, View } from "react-native";
import { FeaturePanel } from "../../components/feature-panel";
import { ReleaseButton } from "../../components/release-button";
import { ReleaseSheet } from "../../components/release-sheet";
import { StatsCard } from "../../components/stats-card";
import { isInFrame } from "../../lib/demo-frame";
import { deferRelease, hasUnseenRelease, isReleaseDeferred, markReleaseSeen, useHasUnseenRelease } from "../../lib/release-seen";
import { LATEST_RELEASE } from "../../lib/releases";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";

// ロゴは両外観で同じワードマーク（600×159。濃い茶はどちらの地でも読める。051）
const LOGO_WIDTH = 120;
const LOGO_HEIGHT = 32;

// 9 枚なので 3 列 × 3 行（4 列だと 4+4+1 で崩れる。040）
const PANEL_COLUMNS = 3;
const PANEL_COLUMN_GAP = 10;

// ホーム: 状態を見て各機能へ入る画面。上から ロゴ → 記念日カード（stats-card.tsx）→ 機能パネル。
// デモで最初に出る画面でもある（020）
export default function HomeScreen() {
  const router = useRouter();
  // react-native-web は columnGap とパーセント幅を併用しても詰め直さない（列ぶんの gap がはみ出して折り返す）。
  // 実測した幅から px で出して FeaturePanel へ渡す
  const [panelGridWidth, setPanelGridWidth] = useState(0);
  const panelWidth =
    panelGridWidth > 0
      ? (panelGridWidth - PANEL_COLUMN_GAP * (PANEL_COLUMNS - 1)) / PANEL_COLUMNS
      : undefined;

  // リリース履歴の未読（ボタンの NEW）。一覧の画面が markReleaseSeen() を呼ぶと消える（043）
  const hasUnseen = useHasUnseenRelease();
  // 「新機能のお知らせ」。未読で、この起動で「後で」を押していなければ 1 度開く。描いたあとに開く
  // （静的書き出しでは window が無く、初期値で開くと hydrate と食い違う）
  const [isReleaseSheetOpen, setIsReleaseSheetOpen] = useState(false);
  // LP のスマホの枠の中では出さない（デモが見えなくなる。releaseSeen も書かない。056）
  useEffect(() => {
    if (!isInFrame() && hasUnseenRelease() && !isReleaseDeferred()) setIsReleaseSheetOpen(true);
  }, []);

  // 「閉じる ×」・シートの外 = 見た。「使ってみる」= 見た + その画面へ。
  // 「後で通知する」= 閉じるだけ（見たことにしない。同じ起動では出し直さない）
  function closeReleaseSheet() {
    markReleaseSeen();
    setIsReleaseSheetOpen(false);
  }
  function tryRelease(route: string) {
    closeReleaseSheet();
    router.push(route);
  }
  function deferReleaseSheet() {
    deferRelease();
    setIsReleaseSheetOpen(false);
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.lg,
          // 機能パネルのグリッドに合わせ横の余白を 20 に
          paddingHorizontal: 20,
          paddingBottom: TAB_BAR_CLEARANCE,
          gap: space.md,
        }}
      >
        <Image
          testID="home-logo-image"
          source={logoMark}
          style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Nisoine"
        />

        <StatsCard />

        {/* パネルは常に出す（取得に失敗しても入口を消さない）。取得状態に依存しないので query の状態を見ない */}
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
          {/* 2 行目の真ん中。panel-today.png と写真タイルは消していない（次フェーズで戻す。041） */}
          <FeaturePanel
            label="アルバム"
            icon={iconPanelAlbum}
            photo={panelPhotoAlbum}
            onPress={() => router.push("/album")}
            width={panelWidth}
          />
          <FeaturePanel label="リスト" icon={iconPanelList}
            photo={panelPhotoList} onPress={() => router.push("/list")} width={panelWidth} />
          {/* 「リスト」の隣（近い意味のものを隣に） */}
          <FeaturePanel
            label="ほしいもの"
            icon={iconPanelWant}
            photo={panelPhotoWant}
            onPress={() => router.push("/want")}
            width={panelWidth}
          />
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

        {/* 3×3 の下に全幅 1 本。未読なら NEW（043） */}
        <ReleaseButton hasNew={hasUnseen} onPress={() => router.push("/releases")} />
      </ScrollView>

      {/* 最新の 1 項目だけ。ゲストにも出す。オンボーディングにはこの画面が無いので出ない */}
      <ReleaseSheet
        visible={isReleaseSheetOpen}
        release={LATEST_RELEASE}
        onTry={tryRelease}
        onLater={deferReleaseSheet}
        onClose={closeReleaseSheet}
      />
    </Screen>
  );
}

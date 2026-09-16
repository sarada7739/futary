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

// 051: ロゴは両モードで同じワードマーク画像（600x159。比率 3.77。濃い茶はどちらの地でも読める）。
// 039 の文字ロゴ（ホワイトだけ Poppins 300 の「futary」）はやめた
const LOGO_WIDTH = 120;
const LOGO_HEIGHT = 32;

// 040: 9 枚目（ほしいもの）が入り 4 列では 4+4+1 で崩れるため 3 列 × 3 行に
// （タスク定義5節。039 で凍結したピンクも変わる。機能が増えれば入口は変わる）
const PANEL_COLUMNS = 3;
const PANEL_COLUMN_GAP = 10;

// 020: ホームを投稿一覧（タイムラインへ独立）から、状態を見て各機能へ入る画面へ
// 変えた。並び順は上から: ロゴ → 記念日カード（ふたりのアバター・記念日・
// 会った日数。stats-card.tsxがこの2つをまとめて持つ） → 機能パネル。
// 014のデモで最初に出る画面でもある
export default function HomeScreen() {
  const router = useRouter();
  // 039 段階2-a でここは appearance を読んでよい 2 箇所の 1 つ（ホームのロゴ）だったが、
  // 051 でロゴが両モード同じ画像になり読まなくなった（残るは統計のヒーローだけ）
  // react-native-webはcolumnGapと"25%"のようなパーセント幅を併用しても
  // 幅を自動で詰め直さない（4列×25%+3個ぶんのgapがコンテナ幅を超え、
  // 4列目が折り返して3列になる不具合を実測で発見した。035）。実測した幅から
  // pxで算出してFeaturePanelへ渡す
  const [panelGridWidth, setPanelGridWidth] = useState(0);
  const panelWidth =
    panelGridWidth > 0
      ? (panelGridWidth - PANEL_COLUMN_GAP * (PANEL_COLUMNS - 1)) / PANEL_COLUMNS
      : undefined;

  // 043: リリース履歴の未読（ホームのボタンの NEW）。一覧の画面が markReleaseSeen() を呼ぶと消える
  const hasUnseen = useHasUnseenRelease();
  // 043: 「新機能のお知らせ」。ホームを開いたときに 1 度（未読で、この起動で「後で」を押していないとき）。
  // 描いたあとに開く（静的書き出しのサーバ側の描画では window が無く、初期値で開くと hydrate と食い違う）
  const [isReleaseSheetOpen, setIsReleaseSheetOpen] = useState(false);
  // 056 0節 #3c: LP のスマホの枠（iframe）の中では出さない（デモが見えなくなる。releaseSeen も書かない）
  useEffect(() => {
    if (!isInFrame() && hasUnseenRelease() && !isReleaseDeferred()) setIsReleaseSheetOpen(true);
  }, []);

  // 「閉じる ×」・シートの外 = 見た（0節 #5）。「使ってみる」= 見た + その画面へ（#6）。
  // 「後で通知する」= 閉じるだけ。見たことにしない。同じ起動では出し直さない（#4）
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
          // 035視覚仕様3節: 機能パネルのグリッドに合わせ横余白を20に
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

        {/* パネルは常に出す。データの取得に失敗しても入口が消えてはいけない
            （タスク定義「状態の網羅」）。取得状態に依存しないため、
            StatsCardのようにquery状態を気にする必要が無い。
            3列×3行のグリッド（040。4列×2行の8枚に「ほしいもの」が加わった） */}
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
          {/* 041: 「今日どうだった？」（押しても何も起きない次フェーズの枠）を「アルバム」に
              置き換えた。位置はそのまま（2 行目の真ん中）。他の 8 枚は動かさない。panel-today.png
              と写真タイルは消していない（次フェーズで戻す。タスク定義3節） */}
          <FeaturePanel
            label="アルバム"
            icon={iconPanelAlbum}
            photo={panelPhotoAlbum}
            onPress={() => router.push("/album")}
            width={panelWidth}
          />
          <FeaturePanel label="リスト" icon={iconPanelList}
            photo={panelPhotoList} onPress={() => router.push("/list")} width={panelWidth} />
          {/* 040: 「リスト」の隣（近い意味のものを隣に。タスク定義5節） */}
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

        {/* 043: 3×3 の下に全幅 1 本。未読なら NEW */}
        <ReleaseButton hasNew={hasUnseen} onPress={() => router.push("/releases")} />
      </ScrollView>

      {/* 043: 最新の 1 項目だけ。ゲストにも出す。オンボーディングにはこの画面が無いので出ない */}
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

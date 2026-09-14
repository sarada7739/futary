import { Card, fontFamily, radius, Screen, space, Text, useTheme } from "@futary/ui";
import { useNavigation, useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, Text as RNText, View } from "react-native";
import { NewBadge } from "../../components/new-badge";
import { markReleaseSeen } from "../../lib/release-seen";
import { formatReleaseDate, RELEASES, type Release } from "../../lib/releases";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";

// 043: リリース履歴（タスク定義 3節。見本 02）。データは lib/releases.ts の配列だけ（11 項目で固定長。
// ページングは無い）。開いた時点で「見た」にする（ホームのバッジも消える。0節 #7）。
// 最新の 1 枚だけ枠を primary にして NEW!（見た・見ないに関係なく。0節 #8）。
// 戻るは `/` に固定（Tabs の中の href: null の画面同士では router.back() の行き先が安定しない。
// album-detail.tsx と同じ理由）。右の × は置かない（戻るが 1 つあれば足りる）

// 数値は B が決めた: 日付は Poppins 18pt bold（数字だけの行）・版のチップは高さ 22・箇条書きの点は 6px
const DATE_FONT_SIZE = 18;
const CHIP_HEIGHT = 22;
const BULLET_SIZE = 6;

function HeaderTextButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={space.sm}
      testID={testID}
      style={{ paddingHorizontal: space.md }}
    >
      <Text color="brand">{label}</Text>
    </Pressable>
  );
}

function ReleaseCard({ release, isLatest, onOpen }: { release: Release; isLatest: boolean; onOpen: (route: string) => void }) {
  const { colors } = useTheme();
  const title = release.emoji ? `${release.title} ${release.emoji}` : release.title;
  return (
    <Card accent={isLatest} testID={`release-card-${release.version}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <RNText
          style={{
            fontFamily: fontFamily.numeric,
            fontSize: DATE_FONT_SIZE,
            lineHeight: 24,
            fontWeight: "700",
            color: colors.text,
          }}
        >
          {formatReleaseDate(release.date)}
        </RNText>
        <View
          style={{
            height: CHIP_HEIGHT,
            paddingHorizontal: space.sm,
            borderRadius: radius.pill,
            backgroundColor: colors.surfaceTint,
            justifyContent: "center",
          }}
        >
          <RNText style={{ fontFamily: fontFamily.numeric, fontSize: 12, lineHeight: CHIP_HEIGHT, color: colors.textMuted }}>
            v{release.version}
          </RNText>
        </View>
        <View style={{ flex: 1 }} />
        {isLatest && <NewBadge label="NEW!" testID="release-card-new" />}
      </View>
      <View style={{ marginTop: space.sm, gap: space.sm }}>
        <Text size="lg" weight="bold">
          {title}
        </Text>
        <View style={{ gap: space.xs }}>
          {release.items.map((item) => (
            <View key={item} style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
              {/* 点は文字の 1 行目の中央に合わせる（Text sm の行の高さ 20 の中央 = 10 − 3） */}
              <View
                style={{
                  width: BULLET_SIZE,
                  height: BULLET_SIZE,
                  borderRadius: BULLET_SIZE / 2,
                  backgroundColor: colors.primary,
                  marginTop: 10 - BULLET_SIZE / 2,
                }}
              />
              <View style={{ flex: 1 }}>
                <Text size="sm">{item}</Text>
              </View>
            </View>
          ))}
        </View>
        {release.route && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`新機能を見る: ${release.title}`}
            onPress={() => onOpen(release.route!)}
            testID={`release-open-${release.version}`}
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              marginTop: space.xs,
              paddingHorizontal: space.lg,
              paddingVertical: space.sm,
              borderRadius: radius.pill,
              backgroundColor: pressed ? colors.border : colors.primarySubtle,
            })}
          >
            <Text size="sm" weight="medium" color="brand">
              新機能を見る →
            </Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

export default function ReleasesScreen() {
  const router = useRouter();
  const navigation = useNavigation();

  // 一覧を開いた = 見た（0節 #7）
  useEffect(() => {
    markReleaseSeen();
  }, []);

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => <HeaderTextButton label="‹ 戻る" onPress={() => router.push("/")} testID="releases-back" />,
    });
    // router は毎回同じ振る舞い。依存に入れると setOptions が描画のたびに走る
  }, [navigation]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.md }}>
        <Text color="muted">これまでのアップデートをご紹介。</Text>
        {RELEASES.map((release, index) => (
          <ReleaseCard key={release.version} release={release} isLatest={index === 0} onOpen={(route) => router.push(route)} />
        ))}
      </ScrollView>
    </Screen>
  );
}

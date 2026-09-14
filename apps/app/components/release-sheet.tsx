import {
  Button,
  Card,
  panelPhotoAi,
  panelPhotoAlbum,
  panelPhotoCalendar,
  panelPhotoList,
  panelPhotoMemory,
  panelPhotoMood,
  panelPhotoStats,
  panelPhotoTimeline,
  panelPhotoWant,
  radius,
  releaseGift,
  space,
  sparkle,
  Text,
  useTheme,
} from "@futary/ui";
import { Image, type ImageSourcePropType, Pressable, View } from "react-native";
import type { Release } from "../lib/releases";
import { NewBadge } from "./new-badge";
import { Sheet } from "./sheet";

// 043: ホームを開いたときの「新機能のお知らせ」（タスク定義 3節。見本 04）。最新の 1 項目だけ。
// 上に絵（ホワイトは見本の贈り物を切り出した releaseGift、ピンクは既存の sparkle。分岐はこの部品の中）、
// NEW、題名、副題、機能のカード（ホームのそのパネルの写真タイルを流用。新しい絵は作らない）、
// 「使ってみる ›」（route があるときだけ）、「後で通知する」、「閉じる ×」。
// 振る舞い（見た・後で）は呼び出し側（ホーム）が持つ。この部品は押されたことを伝えるだけ

// route → ホームのパネルの写真タイル（ホワイトの絵。ピンクでも同じ写真を使う。写真は外観で変わらない）。
// 無い route（/profile 等）は絵無し
const PHOTO_BY_ROUTE: Readonly<Record<string, ImageSourcePropType>> = {
  "/timeline": panelPhotoTimeline,
  "/calendar": panelPhotoCalendar,
  "/memory": panelPhotoMemory,
  "/stats": panelPhotoStats,
  "/album": panelPhotoAlbum,
  "/list": panelPhotoList,
  "/want": panelPhotoWant,
  "/mood": panelPhotoMood,
  "/ai-summary": panelPhotoAi,
};

// 数値は B が決めた: 贈り物の絵は幅いっぱい（元 736×290）で高さ 100 に収める。
// sparkle（122×169）は高さ 56。写真タイルは 88 の正方形（角丸 radius.input）
const GIFT_HEIGHT = 100;
const SPARKLE_HEIGHT = 56;
const SPARKLE_WIDTH = Math.round((SPARKLE_HEIGHT * 122) / 169);
const PHOTO_SIZE = 88;
const ITEMS_IN_SHEET = 2;

export type ReleaseSheetProps = {
  visible: boolean;
  release: Release;
  onTry: (route: string) => void;
  onLater: () => void;
  onClose: () => void;
};

export function ReleaseSheet({ visible, release, onTry, onLater, onClose }: ReleaseSheetProps) {
  const { appearance, colors } = useTheme();
  const photo = release.route ? PHOTO_BY_ROUTE[release.route] : undefined;
  const title = release.emoji ? `${release.title} ${release.emoji}` : release.title;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View testID="release-sheet" style={{ alignItems: "center", gap: space.sm }}>
        {appearance === "white" ? (
          <Image
            testID="release-sheet-gift"
            source={releaseGift}
            style={{ width: "100%", height: GIFT_HEIGHT }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Image
            testID="release-sheet-sparkle"
            source={sparkle}
            style={{ width: SPARKLE_WIDTH, height: SPARKLE_HEIGHT, marginTop: space.sm }}
            resizeMode="contain"
          />
        )}
        <NewBadge testID="release-sheet-new" />
        <Text size="lg" weight="bold" align="center">
          新機能のお知らせ
        </Text>
        <Text color="muted" align="center">
          もっと便利に、もっと楽しく。
        </Text>
      </View>

      <Card>
        <View style={{ flexDirection: "row", gap: space.md }}>
          {photo && (
            <View
              style={{
                width: PHOTO_SIZE,
                height: PHOTO_SIZE,
                borderRadius: radius.input,
                backgroundColor: colors.surfaceTint,
                overflow: "hidden",
              }}
            >
              <Image
                testID="release-sheet-photo"
                source={photo}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            </View>
          )}
          <View style={{ flex: 1, gap: space.xs }}>
            <Text weight="bold">{title}</Text>
            {release.items.slice(0, ITEMS_IN_SHEET).map((item) => (
              <Text key={item} size="sm" color="muted">
                {item}
              </Text>
            ))}
          </View>
        </View>
        {release.route && (
          <View style={{ marginTop: space.md }}>
            <Button onPress={() => onTry(release.route!)} testID="release-sheet-try">
              使ってみる ›
            </Button>
          </View>
        )}
      </Card>

      <View style={{ alignItems: "center", gap: space.sm }}>
        <Pressable accessibilityRole="button" onPress={onLater} hitSlop={space.sm} testID="release-sheet-later">
          <Text size="sm" color="muted">
            後で通知する
          </Text>
        </Pressable>
        <View style={{ width: "100%", height: 1, backgroundColor: colors.border }} />
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={space.sm} testID="release-sheet-close">
          <Text size="sm">閉じる ×</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

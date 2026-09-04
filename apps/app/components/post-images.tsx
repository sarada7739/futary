import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { colors, radius, space, Text } from "@futary/ui";
import type { PostImage } from "@futary/contract";
import { ImageViewer } from "./image-viewer";

export type PostImagesProps = {
  images: PostImage[];
  // ライトボックスを開くPressableのaccessibilityLabel（画面ごとに文言を変える）
  accessibilityLabel?: string;
};

// 031: 1投稿の画像表示（1〜4枚）。post-card.tsx・memory-card.tsxの両方から
// 使う（1枚のときの見え方はどちらの画面でも変えない。タスク定義2節）。
// - 1枚: 従来どおりアスペクト比を保って1枚表示
// - 2枚以上: 正方形にクロップして1行2枚のグリッド。奇数枚は最後の1枚を
//   横幅いっぱいにする（幅の違う枠を混ぜない。タスク定義2節）
export function PostImages({ images, accessibilityLabel = "画像を全画面表示" }: PostImagesProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [failedIndexes, setFailedIndexes] = useState<Set<number>>(new Set());

  if (images.length === 0) return null;

  function openAt(index: number) {
    setViewerIndex(index);
    setViewerOpen(true);
  }

  function markFailed(index: number) {
    setFailedIndexes((prev) => new Set(prev).add(index));
  }

  if (images.length === 1) {
    const image = images[0];
    if (!image) return null;
    const aspectRatio = image.width && image.height ? image.width / image.height : 1;

    if (failedIndexes.has(0)) {
      return (
        <View
          style={{
            padding: space.md,
            borderRadius: radius.input,
            backgroundColor: colors.surfaceTint,
            alignItems: "center",
          }}
        >
          <Text size="sm" color="muted">
            画像を読み込めませんでした
          </Text>
        </View>
      );
    }

    return (
      <>
        {/* 開く操作に副作用は無いため二重発火ガードは不要（conventions.md 4節。017の確認観点） */}
        <Pressable onPress={() => openAt(0)} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
          <Image
            source={{ uri: image.url }}
            style={{ width: "100%", aspectRatio, borderRadius: radius.input }}
            resizeMode="cover"
            onError={() => markFailed(0)}
          />
        </Pressable>
        <ImageViewer visible={viewerOpen} images={images} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} />
      </>
    );
  }

  const isOdd = images.length % 2 === 1;

  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
        {images.map((image, index) => {
          const isLastOdd = isOdd && index === images.length - 1;
          return (
            <Pressable
              key={index}
              onPress={() => openAt(index)}
              accessibilityRole="button"
              accessibilityLabel={`${accessibilityLabel}（${index + 1}枚目）`}
              style={{ width: isLastOdd ? "100%" : "48%", aspectRatio: 1 }}
            >
              {failedIndexes.has(index) ? (
                <View
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: radius.input,
                    backgroundColor: colors.surfaceTint,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text size="xs" color="muted">
                    読み込めません
                  </Text>
                </View>
              ) : (
                <Image
                  source={{ uri: image.url }}
                  style={{ width: "100%", height: "100%", borderRadius: radius.input }}
                  resizeMode="cover"
                  onError={() => markFailed(index)}
                />
              )}
            </Pressable>
          );
        })}
      </View>
      <ImageViewer visible={viewerOpen} images={images} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} />
    </>
  );
}

import { useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { radius, space, Text, useTheme } from "@futary/ui";
import type { PostImage } from "@futary/contract";
import { ImageViewer, type ImageViewerImage } from "./image-viewer";

export type PostImagesProps = {
  images: PostImage[];
  // ライトボックスを開く Pressable の accessibilityLabel（画面ごとに文言を変える）
  accessibilityLabel?: string;
  // 渡すとビューアに保存ボタンが出る（photo.downloadUrl の ref に投稿 ID と位置が要る。041）
  postId?: string;
};

// 次の画像の端を見せるため、1 枚をコンテナ幅より狭くする（pagingEnabled の scroll-snap-align: start は
// 各要素の開始位置に吸着するので、狭くしても送りは効いたまま端が覗く）。値は実機で調整する仮置き（033）
export const ROW_ITEM_WIDTH_RATIO = 0.88;

// 1 枚の画像の高さの上限。収まらない縦長は高さをここまでにして幅を比率で縮め、左寄せ（中央に置かない。050）
export const MAX_SINGLE_IMAGE_HEIGHT = 360;

export type SingleImageLayout =
  | { kind: "full"; width: "100%"; aspectRatio: number }
  | { kind: "capped"; width: number; height: number; alignSelf: "flex-start" };

// 1 枚の画像の置き方。コンテナ幅が分かる前（0）は幅いっぱい
export function singleImageLayout(containerWidth: number, aspectRatio: number): SingleImageLayout {
  if (containerWidth > 0 && containerWidth / aspectRatio > MAX_SINGLE_IMAGE_HEIGHT) {
    return { kind: "capped", width: Math.round(MAX_SINGLE_IMAGE_HEIGHT * aspectRatio), height: MAX_SINGLE_IMAGE_HEIGHT, alignSelf: "flex-start" };
  }
  return { kind: "full", width: "100%", aspectRatio };
}

// 1 投稿の画像（1〜4 枚）。post-card.tsx・memory-card.tsx の両方から使う。
// - 1 枚: アスペクト比を保って表示
// - 2 枚以上: 横一列に並べて指で送る。ドットは置かない（最大 4 枚で、端が見えれば続きがあると分かる。033）
export function PostImages({ images, accessibilityLabel = "画像を全画面表示", postId }: PostImagesProps) {
  const { colors } = useTheme();
  // 投稿カードからのビューアにも保存ボタンを渡す。caption は渡さない（本文はカードに見えている）
  const viewerImages: ImageViewerImage[] = images.map((image, position) => ({
    url: image.url,
    width: image.width,
    height: image.height,
    download: postId ? { kind: "post", postId, position } : undefined,
  }));
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  // 失敗の記録は URL をキーにする（署名付き URL が失効して失敗したあと、再取得で新しい URL が届けば
  // 自然に読み込み直す。添字だと失敗のまま固定される）
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());
  // 横スクロールの中身は幅が定まらないので、子の width:"88%" のような相対指定が効かない（561px の
  // コンテナで子が 77px になった）。外側の View を onLayout で測り、px の幅を子に渡す
  const [containerWidth, setContainerWidth] = useState(0);

  if (images.length === 0) return null;

  function openAt(index: number) {
    setViewerIndex(index);
    setViewerOpen(true);
  }

  function markFailed(url: string) {
    setFailedUrls((prev) => new Set(prev).add(url));
  }

  if (images.length === 1) {
    const image = images[0];
    if (!image) return null;
    const aspectRatio = image.width && image.height ? image.width / image.height : 1;

    if (failedUrls.has(image.url)) {
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

    const layout = singleImageLayout(containerWidth, aspectRatio);
    return (
      <>
        {/* 幅を測ってから高さの上限を当てる（onLayout は 2 枚以上と同じ外側の View で） */}
        <View onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)} testID="post-images-single">
          {/* 開く操作に副作用は無いので二重発火のガードは要らない（conventions.md 4節） */}
          <Pressable
            onPress={() => openAt(0)}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            testID={`post-images-single-${layout.kind}`}
            style={layout.kind === "capped" ? { alignSelf: layout.alignSelf } : undefined}
          >
            <Image
              source={{ uri: image.url }}
              style={
                layout.kind === "capped"
                  ? { width: layout.width, height: layout.height, borderRadius: radius.input }
                  : { width: layout.width, aspectRatio: layout.aspectRatio, borderRadius: radius.input }
              }
              resizeMode="cover"
              onError={() => markFailed(image.url)}
            />
          </Pressable>
        </View>
        <ImageViewer visible={viewerOpen} images={viewerImages} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} />
      </>
    );
  }

  const itemWidth = containerWidth * ROW_ITEM_WIDTH_RATIO;

  return (
    <>
      {/* 幅を測る用。ScrollView の onLayout は安定して発火しないことがあるので、外側のプレーンな View で測る */}
      <View onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}>
        {/* Web の pagingEnabled はコンテナ幅ぴったりの子にしか合わず、子を狭めているのでネイティブでは
            ページ幅がずれる。Web だけを出しているので追わない（ネイティブは snapToInterval が要る） */}
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          testID="post-images-row"
        >
          {images.map((image, index) => (
            <Pressable
              key={index}
              onPress={() => openAt(index)}
              accessibilityRole="button"
              accessibilityLabel={`${accessibilityLabel}（${index + 1}枚目）`}
              testID={`post-images-row-item-${index}`}
              style={{
                // 未測定の最初のフレームは幅 0 で描く（親の flex に任せるとガタつく）
                width: itemWidth,
                aspectRatio: 1,
                marginRight: index < images.length - 1 ? space.xs : 0,
              }}
            >
              {failedUrls.has(image.url) ? (
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
                  onError={() => markFailed(image.url)}
                />
              )}
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <ImageViewer visible={viewerOpen} images={viewerImages} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} />
    </>
  );
}

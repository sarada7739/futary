import { useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { colors, radius, space, Text } from "@futary/ui";
import type { PostImage } from "@futary/contract";
import { ImageViewer } from "./image-viewer";

export type PostImagesProps = {
  images: PostImage[];
  // ライトボックスを開くPressableのaccessibilityLabel（画面ごとに文言を変える）
  accessibilityLabel?: string;
};

// 033: 次の画像の端を見せるため、1枚をコンテナ幅より狭くする。
// scroll-snap-align: start（pagingEnabledが付ける）は各要素自身の開始位置に
// スナップするため、コンテナ幅より狭くしても送りは効いたまま次の端が覗く
// （数値は033タスク定義2節「端がどれくらい見えれば気づくかは実機でしか
// 分からない」により仮置き。人間の実機確認で調整する）
export const ROW_ITEM_WIDTH_RATIO = 0.88;

// 031: 1投稿の画像表示（1〜4枚）。post-card.tsx・memory-card.tsxの両方から
// 使う（1枚のときの見え方はどちらの画面でも変えない。031・033の2回とも
// 守る）。
// - 1枚: 従来どおりアスペクト比を保って1枚表示
// - 2枚以上（033で横一列に変更。正方形グリッドから覆した）: 横一列に並べ、
//   指で送る。ドットのインジケータは置かない（最大4枚。端が見えていれば
//   続きがあることは分かる。タスク定義2節）
export function PostImages({ images, accessibilityLabel = "画像を全画面表示" }: PostImagesProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  // 【033・security-auditor指摘】以前はposition（添字）をキーにしていたため、
  // 署名付きURLが1時間で失効して読み込みに失敗したあと、post.listの
  // 再取得で新しいURLが届いても同じ添字が「失敗」のまま固定されていた。
  // URL自体をキーにすることで、URLが入れ替われば自然に読み込みを再挑戦する
  // （明示的なリセット処理を持たずに済む）
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());
  // 033・実機確認で発見: ScrollView（横スクロール）の中身は幅がコンテンツに
  // 合わせて伸びる「幅が定まらない」コンテナになるため、子要素に
  // width:"88%"のような文字列（相対）指定をしても、コンテナ自身の幅が
  // 定まっていないため正しく解決されない（実測: 561px幅のコンテナに対し、
  // 子要素が77pxほどにしかならない不具合を発見した）。外側の
  // 幅が定まったViewをonLayoutで実測し、そこから算出したpx単位の幅を
  // 子要素に渡す
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

    return (
      <>
        {/* 開く操作に副作用は無いため二重発火ガードは不要（conventions.md 4節。017の確認観点） */}
        <Pressable onPress={() => openAt(0)} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
          <Image
            source={{ uri: image.url }}
            style={{ width: "100%", aspectRatio, borderRadius: radius.input }}
            resizeMode="cover"
            onError={() => markFailed(image.url)}
          />
        </Pressable>
        <ImageViewer visible={viewerOpen} images={images} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} />
      </>
    );
  }

  const itemWidth = containerWidth * ROW_ITEM_WIDTH_RATIO;

  return (
    <>
      {/* 幅測定用。ScrollView自体はonLayoutが安定して発火しない場合があるため
          （横スクロールの中身の幅計算と競合しうる）、外側のプレーンなViewで
          コンテナ幅を測る */}
      <View onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}>
        {/* horizontal + pagingEnabled はネイティブでは正しくページングするが、
            Webではコンテナ幅ぴったりの子要素にしか使えない（033タスク定義0節で
            実測確認済み）。子要素をROW_ITEM_WIDTH_RATIOで狭めているため、
            ネイティブ（iOS/Android）ではこのままだとコンテナ幅とページ幅が
            ずれてpagingEnabledの前提が崩れる。033はWebだけを出す判断のため
            追わない（ネイティブは`snapToInterval`が要る。Aの判断） */}
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
                // 未測定（containerWidth===0）の最初のフレームだけは古い
                // レイアウト（親のflexに任せる）にせず、幅0で描画して
                // レイアウトのガタつきを避ける
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
      <ImageViewer visible={viewerOpen} images={images} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} />
    </>
  );
}

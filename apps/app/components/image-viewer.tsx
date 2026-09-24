import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, View } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { PhotoRef } from "@futary/contract";
import { radius, space, Text, useTheme } from "@futary/ui";
import { downloadPhoto } from "../lib/photo-download";

// 画像ごとの説明文（アルバムのビューアの左下）。title = アルバム名、date = 撮影日、body = 写真の説明文
// （タイムラインなら投稿本文）。無ければ何も出さない（041）
export type ImageViewerCaption = {
  title: string;
  date: string;
  body: string;
};

export type ImageViewerImage = {
  url: string;
  width: number;
  height: number;
  // 画像ごと。あれば下に重ねて出す
  caption?: ImageViewerCaption;
  // 画像ごと。あれば右下に保存ボタン（photo.downloadUrl → 保存）
  download?: PhotoRef;
};

export type ImageViewerProps = {
  visible: boolean;
  images: ImageViewerImage[];
  // 開いたときに表示する枚数。省略時は 0 枚目
  initialIndex?: number;
  onClose: () => void;
  // アルバムの写真だけ。説明文を押すと呼ばれる（呼び出し側が入力を出す）。ゲスト・タイムラインでは渡さない
  onEditCaption?: (index: number) => void;
};

// 説明文の本文は 3 行で省略
const CAPTION_BODY_LINES = 3;

// 投稿画像の全画面表示（017）。expo-router のモーダルルートにしない（一覧が返した署名付き URL をそのまま
// 使う。ルートにすると投稿 ID から URL を引き直す経路ができる）。animationType は指定しない
// （react-native-web の Modal は animationend を待って閉じるので、jsdom で閉じる導線を試せなくなる）。
//
// 全画面では次の端が見えないので、ドットでなく「n / 総数」を出す。ページは横一列の ScrollView
// （horizontal + pagingEnabled）で、各ページはコンテナ幅いっぱい。
// どこをタップしても閉じる（画像の上も含む）。画像側だけ除くと、contain の余白（レターボックス）まで
// 画像の Pressable が覆って閉じなくなる。画像・ページには onPress を持たせず、backdrop の Pressable が
// 受け取る。横のスワイプは ScrollView がレスポンダを取るので、閉じると混ざらない（017・033）。
//
// 左右・× ボタンは backdrop の中の入れ子の Pressable（自分の onPress で止まり、親へは伝わらない）。
// backdrop に accessibilityRole="button" を付けない: react-native-web は <button> を描くので、
// 中のボタンと <button> の入れ子になり DOM の構造エラーが出る
export function ImageViewer({ visible, images, initialIndex = 0, onClose, onEditCaption }: ImageViewerProps) {
  const { colors } = useTheme();
  // 保存ボタンの状態（押している画像の index。失敗したら 1 行出す）
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [loadedIndexes, setLoadedIndexes] = useState<Set<number>>(new Set());
  const [failedIndexes, setFailedIndexes] = useState<Set<number>>(new Set());
  const [index, setIndex] = useState(initialIndex);
  const scrollRef = useRef<ScrollView>(null);
  const containerWidthRef = useRef(0);
  // 横スクロールの中身は幅の定まらないコンテナなので、子の width:"100%" が効かない。ページの幅も
  // onLayout の実測を使う（scrollTo の計算には同期で読める ref、描画には state）
  const [containerWidth, setContainerWidth] = useState(0);

  // 開くたびに戻す（前回の失敗の状態を持ち越さない）
  useEffect(() => {
    if (visible) {
      setLoadedIndexes(new Set());
      setFailedIndexes(new Set());
      setDownloadingIndex(null);
      setDownloadFailed(false);
      setIndex(initialIndex);
      // レイアウトが決まったら initialIndex の位置へ飛ぶ（アニメーションなし）。幅が 0（jsdom 等）なら何もしない
      requestAnimationFrame(() => {
        if (containerWidthRef.current > 0) {
          scrollRef.current?.scrollTo({ x: containerWidthRef.current * initialIndex, animated: false });
        }
      });
    }
    // images の枚数が変わったときも戻す（今の呼び出し元では起きないが、差し替わる経路への備え）
  }, [visible, initialIndex, images.length]);

  const total = images.length;
  // 枚数が変わった直後の 1 フレームは古い index が範囲外になりうる（上の effect の前）。
  // 描画とボタンの判定は必ずこのクランプ済みの値を通す
  const safeIndex = Math.max(0, Math.min(total - 1, index));
  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < total - 1;

  function scrollToIndex(next: number) {
    setIndex(next);
    if (containerWidthRef.current > 0) {
      scrollRef.current?.scrollTo({ x: containerWidthRef.current * next, animated: true });
    }
  }
  function goPrev() {
    if (!hasPrev) return;
    scrollToIndex(safeIndex - 1);
  }
  function goNext() {
    if (!hasNext) return;
    scrollToIndex(safeIndex + 1);
  }

  // スワイプで送った位置から何枚目かを読み直す。幅はイベントの layoutMeasurement.width から読む
  // （別の state だと測るタイミングがずれうる。テストでもイベントに値を与えれば試せる）。
  // react-native-web の ScrollView は onScroll しか呼ばない（onScrollEndDrag・onMomentumScrollEnd は
  // Web では届かない）ので、onScroll で都度計算する。Math.round(offset / pageWidth) はドラッグ中の
  // ほとんどで同じ値で、同じ値の setIndex は再描画しないので費用は問題にならない
  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    scrolledSincePressInRef.current = true;
    const pageWidth = e.nativeEvent.layoutMeasurement.width;
    if (!pageWidth) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    setIndex(Math.max(0, Math.min(total - 1, next)));
  }

  // react-native-web は click が届けば移動量を見ずに onPress を呼ぶ。デスクトップのマウスドラッグは
  // スクロールコンテナを動かさず click だけが届くので、「ドラッグで送る」が閉じるとして誤発火する。
  // press の開始から click までに onScroll が 1 度でも起きたら送り操作とみなし、閉じない
  const scrolledSincePressInRef = useRef(false);

  // 保存。photo.downloadUrl（5 分の署名付き URL）を取って <a download> を押す。副作用があるので押している
  // 間は無効にする。Button を使わないのは、ビューアのボタンを backdrop の入れ子の Pressable に揃えるため
  async function handleDownload(i: number) {
    const ref = images[i]?.download;
    if (!ref || downloadingIndex !== null) return;
    setDownloadFailed(false);
    setDownloadingIndex(i);
    try {
      await downloadPhoto(ref);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloadingIndex(null);
    }
  }

  const current = images[safeIndex];

  function handleBackdropPressIn() {
    scrolledSincePressInRef.current = false;
  }
  function handleBackdropPress() {
    if (scrolledSincePressInRef.current) return;
    onClose();
  }

  return (
    <Modal visible={visible} transparent onRequestClose={onClose}>
      <Pressable
        onPress={handleBackdropPress}
        onPressIn={handleBackdropPressIn}
        testID="image-viewer-backdrop"
        style={{ flex: 1, backgroundColor: colors.overlay }}
        onLayout={(e) => {
          const width = e.nativeEvent.layout.width;
          containerWidthRef.current = width;
          setContainerWidth(width);
        }}
      >
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={total > 1}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          testID="image-viewer-scroll"
          style={{ flex: 1 }}
        >
          {images.map((image, i) => (
            <View
              key={i}
              style={{ width: containerWidth, height: "100%", alignItems: "center", justifyContent: "center" }}
            >
              {failedIndexes.has(i) ? (
                <Text color="inverse">画像を読み込めませんでした</Text>
              ) : (
                <>
                  <Image
                    source={{ uri: image.url }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="contain"
                    onLoad={() => setLoadedIndexes((prev) => new Set(prev).add(i))}
                    onError={() => setFailedIndexes((prev) => new Set(prev).add(i))}
                    testID={i === safeIndex ? "image-viewer-image" : undefined}
                  />
                  {!loadedIndexes.has(i) && (
                    <View style={{ position: "absolute" }}>
                      <ActivityIndicator
                        color={colors.surface}
                        size="large"
                        testID={i === safeIndex ? "image-viewer-loading" : undefined}
                      />
                    </View>
                  )}
                </>
              )}
            </View>
          ))}
        </ScrollView>

        {total > 1 && (
          <>
            <Pressable
              onPress={goPrev}
              disabled={!hasPrev}
              accessibilityRole="button"
              accessibilityLabel="前の画像"
              hitSlop={space.md}
              testID="image-viewer-prev"
              style={{
                position: "absolute",
                left: space.md,
                top: "50%",
                opacity: hasPrev ? 1 : 0.3,
              }}
            >
              <Text color="inverse" size="xl">
                ‹
              </Text>
            </Pressable>
            <Pressable
              onPress={goNext}
              disabled={!hasNext}
              accessibilityRole="button"
              accessibilityLabel="次の画像"
              hitSlop={space.md}
              testID="image-viewer-next"
              style={{
                position: "absolute",
                right: space.md,
                top: "50%",
                opacity: hasNext ? 1 : 0.3,
              }}
            >
              <Text color="inverse" size="xl">
                ›
              </Text>
            </Pressable>

            <View style={{ position: "absolute", top: space.xl, alignSelf: "center" }} testID="image-viewer-counter">
              <Text color="inverse" size="sm">
                {`${safeIndex + 1} / ${total}`}
              </Text>
            </View>
          </>
        )}

        {/* 表示中の画像の説明文（左下）と保存ボタン（右下）。backdrop の入れ子なので押しても閉じない。
            画像ごとに有無が違うので、表示中の 1 枚の分だけ描く */}
        {(current?.caption || current?.download) && (
          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              left: space.lg,
              right: space.lg,
              bottom: space.xxl,
              flexDirection: "row",
              alignItems: "flex-end",
              gap: space.md,
            }}
          >
            <View style={{ flex: 1 }} pointerEvents="box-none">
              {current?.caption && (
                <Pressable
                  onPress={onEditCaption ? () => onEditCaption(safeIndex) : undefined}
                  disabled={!onEditCaption}
                  accessibilityLabel={onEditCaption ? "説明を編集" : undefined}
                  testID="image-viewer-caption"
                  style={{ gap: space.xs }}
                >
                  <Text color="inverse" weight="bold">
                    {current.caption.title}
                  </Text>
                  <Text color="inverse" size="sm">
                    {current.caption.date}
                  </Text>
                  {current.caption.body.length > 0 ? (
                    <Text color="inverse" numberOfLines={CAPTION_BODY_LINES}>
                      {current.caption.body}
                    </Text>
                  ) : onEditCaption ? (
                    // 空なら「説明を追加」を薄く出す（アルバムだけ）
                    <View style={{ opacity: 0.6 }}>
                      <Text color="inverse" size="sm">
                        説明を追加
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              )}
            </View>
            {current?.download && (
              <View style={{ alignItems: "flex-end", gap: space.xs }}>
                {downloadFailed && (
                  <Text color="inverse" size="xs">
                    保存できませんでした
                  </Text>
                )}
                <Pressable
                  onPress={() => handleDownload(safeIndex)}
                  disabled={downloadingIndex !== null}
                  accessibilityRole="button"
                  accessibilityLabel="保存"
                  hitSlop={space.sm}
                  testID="image-viewer-download"
                  style={{
                    paddingVertical: space.sm,
                    paddingHorizontal: space.lg,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surface,
                    opacity: downloadingIndex !== null ? 0.6 : 1,
                  }}
                >
                  <Text weight="bold" size="sm">
                    {downloadingIndex === safeIndex ? "保存中…" : "保存"}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          hitSlop={space.md}
          testID="image-viewer-close"
          style={{ position: "absolute", top: space.xl, right: space.xl }}
        >
          <Text color="inverse" size="xl">
            ×
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

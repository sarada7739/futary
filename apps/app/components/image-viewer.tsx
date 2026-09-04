import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, View } from "react-native";
import { colors, space, Text } from "@futary/ui";

export type ImageViewerImage = {
  url: string;
  width: number;
  height: number;
};

export type ImageViewerProps = {
  visible: boolean;
  images: ImageViewerImage[];
  // 開いたときにどの枚数を表示するか。省略時は0枚目
  initialIndex?: number;
  onClose: () => void;
};

// 017: 投稿画像の全画面表示。031で複数枚に対応した。expo-routerのモーダル
// ルートにはしない（post.listが既に返している署名付きURLをそのまま使うため。
// ルートにすると投稿IDからURLを引き直す経路を新設してしまう。L46と同じ形）。
// animationTypeは指定しない（既定none）。react-native-webのModalはフェード等の
// アニメーション終了をCSSのanimationendイベントで検知するため、closeが
// 「アニメーション完了後」まで実際にDOMへ反映されず、閉じる導線の画面結合
// テストが書けなくなる（jsdomはCSSアニメーションを実行しない）。
// 閉じるのは「どこをタップしても」（画像の上も含む）。当初は「画像の外側」の
// みを閉じる導線にしていたが、contain指定で画像が実際に表示されない余白
// （レターボックス）の当たり判定を画像側のPressableが覆ってしまい、その部分を
// タップしても閉じない不具合をRのレビューで指摘された。当たり判定を実表示領域に
// 合わせる案（onLayoutでの計算）は、jsdomでonLayoutが発火せず画面結合テストで
// 検証できない。ピンチズームを入れない以上、画像タップを特別扱いする機能的な
// 理由も無いため、当たり判定という概念自体を無くす方針にした
// （docs/tasks/017-image-lightbox.md参照）。
//
// 031: 複数枚は左右のボタンで送る（スワイプにしない。requirements.md 5節で
// ジェスチャライブラリはスコープ外のまま。docs/tasks/031-multi-image.md 2節）。
// 左右ボタン・×ボタンはどちらもbackdropのPressableに入れ子のPressableとして
// 置く。React Nativeのタッチレスポンダは入れ子のPressableが自分のonPressを
// 消費し、親（backdrop）のonPressへは伝播しないため、閉じずに送りだけが起こる
export function ImageViewer({ visible, images, initialIndex = 0, onClose }: ImageViewerProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [index, setIndex] = useState(initialIndex);

  // 開くたびにリセットする。前回別の画像・別の枚数で失敗した状態を持ち越さない
  useEffect(() => {
    if (visible) {
      setStatus("loading");
      setIndex(initialIndex);
    }
  }, [visible, initialIndex]);

  const total = images.length;
  const current = images[index];
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  function goPrev() {
    if (!hasPrev) return;
    setStatus("loading");
    setIndex((i) => i - 1);
  }
  function goNext() {
    if (!hasNext) return;
    setStatus("loading");
    setIndex((i) => i + 1);
  }

  return (
    <Modal visible={visible} transparent onRequestClose={onClose}>
      {/* どこをタップしても閉じる（画像の上も含む）。accessibilityRole="button"を
          付けない: react-native-webはaccessibilityRole="button"のPressableを
          実際の<button>に描画するため、内側の×・‹・›ボタン（同じくbutton）が
          <button>の入れ子になり、ブラウザのコンソールに「buttonがbuttonを
          含められない」というDOM構造エラーが出ることを031でブラウザ実測して
          発見した（1個のときから存在していたが、複数枚対応で3個に増えて顕在化）。
          クリックの挙動自体は壊れないが、意味のある構造にするため役割を外す */}
      <Pressable
        onPress={onClose}
        testID="image-viewer-backdrop"
        style={{ flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center" }}
      >
        {!current || status === "error" ? (
          <Text color="inverse">画像を読み込めませんでした</Text>
        ) : (
          <View style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <Image
              source={{ uri: current.url }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="contain"
              onLoad={() => setStatus("loaded")}
              onError={() => setStatus("error")}
              testID="image-viewer-image"
            />
            {status === "loading" && (
              <View style={{ position: "absolute" }}>
                <ActivityIndicator color={colors.surface} size="large" testID="image-viewer-loading" />
              </View>
            )}
          </View>
        )}

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
                {`${index + 1} / ${total}`}
              </Text>
            </View>
          </>
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

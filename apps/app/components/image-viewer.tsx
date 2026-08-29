import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, View } from "react-native";
import { colors, space, Text } from "@futary/ui";

export type ImageViewerProps = {
  visible: boolean;
  imageUrl: string;
  onClose: () => void;
};

// 017: 投稿画像の全画面表示。expo-routerのモーダルルートにはしない
// （post.listが既に返している署名付きURLをそのまま使うため。ルートにすると
// 投稿IDからURLを引き直す経路を新設してしまう。L46と同じ形）。
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
// （docs/tasks/017-image-lightbox.md参照）
export function ImageViewer({ visible, imageUrl, onClose }: ImageViewerProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  // 開くたびにリセットする。前回別の画像で失敗した状態を持ち越さない
  useEffect(() => {
    if (visible) setStatus("loading");
  }, [visible, imageUrl]);

  return (
    <Modal visible={visible} transparent onRequestClose={onClose}>
      {/* どこをタップしても閉じる（画像の上も含む） */}
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="画像を閉じる"
        testID="image-viewer-backdrop"
        style={{ flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center" }}
      >
        {status === "error" ? (
          <Text color="inverse">画像を読み込めませんでした</Text>
        ) : (
          <View style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <Image
              source={{ uri: imageUrl }}
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

import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, View } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
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

// 017: 投稿画像の全画面表示。031で複数枚（左右ボタン）に対応し、
// 033でスワイプにも対応した。expo-routerのモーダルルートにはしない
// （post.listが既に返している署名付きURLをそのまま使うため。ルートにすると
// 投稿IDからURLを引き直す経路を新設してしまう。L46と同じ形）。
// animationTypeは指定しない（既定none）。react-native-webのModalはフェード等の
// アニメーション終了をCSSのanimationendイベントで検知するため、closeが
// 「アニメーション完了後」まで実際にDOMへ反映されず、閉じる導線の画面結合
// テストが書けなくなる（jsdomはCSSアニメーションを実行しない）。
//
// 033: 全画面では次の端が見えないため、ドットではなく「n / 総数」を出す
// （タスク定義3節）。ページは横一列のScrollView（horizontal + pagingEnabled。
// 0節でWebで効くことを実測確認済み）で、各ページはコンテナ幅いっぱい
// （post-images.tsxの一覧行と違い、ここでは次の端を見せない設計）。
// 閉じるのは「どこをタップしても」（画像の上も含む）。当初は「画像の外側」の
// みを閉じる導線にしていたが、contain指定で画像が実際に表示されない余白
// （レターボックス）の当たり判定を画像側のPressableが覆ってしまい、その部分を
// タップしても閉じない不具合をRのレビューで指摘された。当たり判定を実表示領域に
// 合わせる案（onLayoutでの計算）は、jsdomでonLayoutが発火せず画面結合テストで
// 検証できない。ピンチズームを入れない以上、画像タップを特別扱いする機能的な
// 理由も無いため、当たり判定という概念自体を無くす方針にした
// （docs/tasks/017-image-lightbox.md参照）。033でもこの形は変えていない:
// 画像・ページ自体には onPress を持たせず、backdropのPressableが
// タップをそのまま受け取る。ScrollViewが横方向の移動を検知すると
// React Nativeのタッチレスポンダがそちらへ処理を譲るため、スワイプ操作は
// backdropのonPress（閉じる）とは競合しない（送りと閉じるが混ざらない。
// タスク定義3節「スワイプで閉じる操作を足さない」はこの構造で自然に満たす。
// 縦方向のPanResponderを別途足していないため、縦スワイプでの誤閉じも起きない）。
//
// 左右ボタン・×ボタンはどれもbackdropのPressableに入れ子のPressableとして
// 置く。React Nativeのタッチレスポンダは入れ子のPressableが自分のonPressを
// 消費し、親（backdrop）のonPressへは伝播しないため、閉じずに送りだけが起こる。
// accessibilityRole="button"を付けない: react-native-webはaccessibilityRole=
// "button"のPressableを実際の<button>に描画するため、内側の×・‹・›ボタン
// （同じくbutton）が<button>の入れ子になり、ブラウザのコンソールに
// 「buttonがbuttonを含められない」というDOM構造エラーが出ることを031で
// ブラウザ実測して発見した。クリックの挙動自体は壊れないが、意味のある
// 構造にするため役割を外す
export function ImageViewer({ visible, images, initialIndex = 0, onClose }: ImageViewerProps) {
  const [loadedIndexes, setLoadedIndexes] = useState<Set<number>>(new Set());
  const [failedIndexes, setFailedIndexes] = useState<Set<number>>(new Set());
  const [index, setIndex] = useState(initialIndex);
  const scrollRef = useRef<ScrollView>(null);
  const containerWidthRef = useRef(0);
  // 033・実機確認で発見: post-images.tsxの一覧行と同じ理由（横スクロールの
  // 中身は幅が定まらないコンテナになるため、子のwidth:"100%"が正しく
  // 解決されない）で、ページの幅もonLayoutの実測px値を使う。scrollToの
  // 計算には同期的に読めるref、描画には再レンダーを起こすstateの両方を使う
  const [containerWidth, setContainerWidth] = useState(0);

  // 開くたびにリセットする。前回別の画像・別の枚数で失敗した状態を持ち越さない
  useEffect(() => {
    if (visible) {
      setLoadedIndexes(new Set());
      setFailedIndexes(new Set());
      setIndex(initialIndex);
      // レイアウト確定後にinitialIndexの位置へ飛ぶ（アニメーションなし）。
      // containerWidthが0（未測定。jsdom等）のときはx:0のまま何もしない
      requestAnimationFrame(() => {
        if (containerWidthRef.current > 0) {
          scrollRef.current?.scrollTo({ x: containerWidthRef.current * initialIndex, animated: false });
        }
      });
    }
    // imagesの枚数が変わった場合（現状の呼び出し元では起こらないが、
    // 将来images自体が差し替わる経路ができたときの防御。security-auditor
    // 指摘: indexのクランプがhandleScroll内にしか無く、他の経路を信じて
    // 良いかがコードから読み取れない状態だった）も同様にリセットする
  }, [visible, initialIndex, images.length]);

  const total = images.length;
  // images.lengthが変わった直後の1フレームだけ、古いindexが範囲外になりうる
  // （上のuseEffectがまだ走っていないタイミング）。描画・ボタン判定は必ず
  // このクランプ済みの値を経由させる（security-auditor指摘: クランプが
  // handleScrollの1箇所にしか無いと、他の経路も守られていると誤読されうる）
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

  // スワイプで送った位置から、何枚目かを読み直す（タスク定義3節
  // 「スワイプで送れるようにする」）。ページ幅はイベント自身の
  // layoutMeasurement.widthから読む（別途状態化したcontainerWidthに頼ると
  // 測定タイミングとずれうる。画面結合テストでも、この値をイベントに
  // 直接与えれば実レイアウト無しで検証できる）。
  // 【実装上の注意】react-native-webのScrollViewBase（node_modules内の
  // 実装を実測して確認）は、内部で`onScroll`しか呼ばない。`onScrollEndDrag`・
  // `onMomentumScrollEnd`はScrollViewの外側の層にpropとして渡って
  // いるだけで、Web版のベース実装からは一度も呼ばれない（ネイティブ
  // 〈iOS/Android〉では実際のスクロール終了イベントとして届くが、Webでは
  // 届かない）。そのため`onScroll`を使い、ドラッグ中も含めて都度
  // 計算し直す（最後に呼ばれた値が着地点になる。デバウンスは要らない）
  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    scrolledSincePressInRef.current = true;
    const pageWidth = e.nativeEvent.layoutMeasurement.width;
    if (!pageWidth) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    setIndex(Math.max(0, Math.min(total - 1, next)));
  }

  // 【033・security-auditor指摘】react-native-webのPressResponderは、
  // ブラウザのclickイベントさえ届けば指の移動量を見ずにonPressを呼ぶ
  // （テキスト選択が起きた場合だけ取り消す）。タッチはブラウザがスクロール後の
  // clickを抑止するため実害が無いが、**デスクトップのマウスドラッグは
  // ネイティブのスクロールコンテナを動かさずclickだけが届く**ため、
  // 「横にドラッグして送る」つもりの操作がbackdropのonPress（閉じる）として
  // 誤発火しうる。press開始からclickまでの間にonScrollが1度でも起きていれば
  // 送り操作とみなし、閉じない
  const scrolledSincePressInRef = useRef(false);
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

import { fontFamily, radius, space, useTheme, type Glass } from "@futary/ui";
import type { Tabs } from "expo-router";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { TAB_BAR_BOTTOM_MARGIN, TAB_BAR_HEIGHT } from "../lib/tab-bar-layout";
import {
  clamp,
  maxPillX,
  nearestAllowedIndex,
  nearestTabIndex,
  pillRestX,
  stretchForVelocity,
} from "../lib/tab-pill";

// 湾曲ガラスのタブバー（061）。既定のタブバーでは層を積めないので、Tabs の `tabBar` にこの部品を渡す。
// 項目・遷移・状態は navigator のまま（state と descriptors を読むだけで、自前の選択状態を持たない）。
//
// SVG フィルタ（url()）は使わない。iPhone の Safari では `backdrop-filter: url()` が背景をずらした
// 帯・縞を描き、`filter: url()` はアイコンを二重にした（`CSS.supports` は true を返すので見分けられない）。
// ピルにも backdrop-filter を置かない（transform と同時だと Safari が背後を二重に描く）。
// 残る層は、ぼかし（glass-blur。backdrop-filter はこの 1 箇所）・板（色とグラデーション）・色収差・フチ・
// ピル（色・フチ・inset の光）。url( が無いこと・backdrop-filter が 1 箇所なことはテスト G5 が留める
const PILL_HEIGHT = 44;
// スロットの中でピルが左右に残す余白
const PILL_INSET = 5;
// 押している間の膨らみ。バーからはみ出す
const PRESS_SCALE = 1.12;
// これを超えて横に動いたらドラッグとして扱う。下回る動きはタップに渡す
const DRAG_THRESHOLD = 6;

// react-native-web にしか無い CSS プロパティを style に流す包み（ネイティブでは null）
function webOnly(style: Record<string, string | number>): object | null {
  return Platform.OS === "web" ? (style as object) : null;
}

// タブに出さない画面の判定。`_layout.tsx` の `href: null` は navigator まで届かない: expo-router が剥がし、
// `tabBarItemStyle: { display: "none" }` と null を返す tabBarButton に置き換える（TabsClient.js）。
// `options.href` は常に undefined で、見ると隠し画面 12 枚がタブに並ぶ。既定のタブバーと同じく display で見る
function isHiddenFromTabBar(options: { tabBarItemStyle?: StyleProp<ViewStyle> }): boolean {
  return StyleSheet.flatten(options.tabBarItemStyle)?.display === "none";
}

/** ガラスの板。ぼかし・板・フチ・色収差を重ねる。中身（ピル・項目）は持たない */
function GlassPane({ glass }: { glass: Glass }) {
  const blur = `blur(${glass.blurRadius}px) saturate(${glass.saturate})`;
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: radius.pill, overflow: "hidden" }]} pointerEvents="none">
      {/* 1. ぼかし。url() を含めない（全ブラウザで効かせる） */}
      <View
        testID="glass-blur"
        style={[
          StyleSheet.absoluteFill,
          webOnly({ backdropFilter: blur, WebkitBackdropFilter: blur }),
        ]}
      />
      {/* 2. ガラス板。色（tint）と、左上が明るく右下が暗い斜めのグラデーション。歪ませない */}
      <View
        testID="glass-sheet"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: glass.tint },
          webOnly({
            backgroundImage:
              `linear-gradient(135deg, ${glass.edgeHighlight} 0%, transparent 28%, ` +
              `transparent 72%, ${glass.edgeReflection} 100%)`,
          }),
        ]}
      />
      {/* 3. 色収差。inset の影を左右に振ると端にだけ虹色が出る。ホワイトは aberration が 0 で出さない（039） */}
      {glass.aberration > 0 && (
        <View
          testID="glass-aberration"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius.pill },
            webOnly({
              boxShadow:
                `inset ${glass.aberration}px 0 ${glass.aberration * 2}px ${glass.aberrationCool}, ` +
                `inset -${glass.aberration}px 0 ${glass.aberration * 2}px ${glass.aberrationWarm}`,
            }),
          ]}
        />
      )}
      {/* 4. フチ。左上からの光と、反対側の弱い反射 */}
      <View
        testID="glass-rim"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius.pill, borderWidth: 1, borderColor: glass.rim },
          webOnly({
            boxShadow:
              `inset 1px 1px 0 ${glass.edgeHighlight}, inset -1px -1px 0 ${glass.edgeReflection}`,
          }),
        ]}
      />
    </View>
  );
}

// expo-router は BottomTabBarProps を公開していない（build/ の中を直接 import すると内部構成の変更で壊れる）。
// `tabBar` の引数の型から引く。型だけなので実行時に expo-router を読まない（テストでモックが要らない）
export type GlassTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

export function GlassTabBar({ state, descriptors, navigation }: GlassTabBarProps) {
  const { colors, glass, shadow } = useTheme();
  const [barWidth, setBarWidth] = useState(0);
  // 隠し画面（思い出・統計など）はボタンとして出さない
  const visible = state.routes
    .map((route, index) => ({ route, index }))
    .filter(({ route }) => {
      const options = descriptors[route.key]?.options;
      return options !== undefined && !isHiddenFromTabBar(options);
    });

  const focusedVisible = visible.findIndex(({ index }) => index === state.index);
  // ピルが乗ってよいスロット。＋投稿（tabBarButton）は選ばれた状態にならないので外す
  const pillSlots = visible
    .map((entry, visibleIndex) => ({ entry, visibleIndex }))
    .filter(({ entry }) => descriptors[entry.route.key]?.options.tabBarButton === undefined)
    .map(({ visibleIndex }) => visibleIndex);
  const slotWidth = visible.length > 0 ? barWidth / visible.length : 0;
  const pillWidth = Math.max(slotWidth - PILL_INSET * 2, 0);

  const translateX = useRef(new Animated.Value(0)).current;
  const stretch = useRef(new Animated.Value(1)).current;
  const press = useRef(new Animated.Value(1)).current;
  // ドラッグ中に今の位置を読むための写し（Animated.Value は同期で読めない）
  const pillX = useRef(0);
  const dragStart = useRef(0);

  // PanResponder は最初の描画で 1 度だけ作られるので、ハンドラから今の値を読めるように写しを置く
  // （クロージャが初回の値を抱えたままになるのを避ける）
  const barWidthRef = useRef(0);
  const slotWidthRef = useRef(0);
  const visibleCountRef = useRef(0);
  const pillSlotsRef = useRef<readonly number[]>([]);
  const restXRef = useRef(0);
  const goToRef = useRef<(visibleIndex: number) => void>(() => {});
  const settleBackRef = useRef<() => void>(() => {});

  useEffect(() => {
    const id = translateX.addListener(({ value }) => {
      pillX.current = value;
    });
    return () => translateX.removeListener(id);
  }, [translateX]);

  const restX = focusedVisible >= 0 ? pillRestX(focusedVisible, slotWidth, PILL_INSET) : 0;

  // 選択が変わったらスプリングで寄せる。幅が測れていない間は動かさない。最初に測れたときはその位置から
  // 始める（onLayout は描画の後なので、spring だと毎回左端から飛んでくる）
  const placed = useRef(false);
  useEffect(() => {
    if (slotWidth <= 0 || focusedVisible < 0) return;
    if (!placed.current) {
      placed.current = true;
      translateX.setValue(restX);
      return;
    }
    Animated.spring(translateX, {
      toValue: restX,
      useNativeDriver: false,
      speed: 14,
      bounciness: 8,
    }).start();
  }, [restX, slotWidth, focusedVisible, translateX]);

  function goTo(visibleIndex: number) {
    const target = visible[visibleIndex];
    if (!target) return;
    const descriptor = descriptors[target.route.key];
    if (!descriptor) return;
    const isFocused = state.index === target.index;
    const event = navigation.emit({
      type: "tabPress",
      target: target.route.key,
      canPreventDefault: true,
    });
    // ＋投稿（FAB）は listeners で preventDefault して /compose を開く。ここで navigate すると二重に動く
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(target.route.name, target.route.params);
    }
  }

  // ドラッグをやめた・奪われたときの後始末（押し込みと伸びを戻し、選ばれているタブの上へ戻す）
  function settleBack() {
    Animated.timing(press, { toValue: 1, duration: 140, useNativeDriver: false }).start();
    Animated.spring(stretch, { toValue: 1, useNativeDriver: false, speed: 12, bounciness: 10 }).start();
    const slot = slotWidthRef.current;
    if (slot <= 0) return;
    Animated.spring(translateX, {
      toValue: restXRef.current,
      useNativeDriver: false,
      speed: 13,
      bounciness: 9,
    }).start();
  }

  const pan = useRef(
    PanResponder.create({
      // 横に DRAG_THRESHOLD を超えたときだけ引き取る（下回る動きは項目に渡し、タップを殺さない）
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > DRAG_THRESHOLD,
      onPanResponderGrant: () => {
        dragStart.current = pillX.current;
        Animated.timing(press, { toValue: PRESS_SCALE, duration: 120, useNativeDriver: false }).start();
      },
      onPanResponderMove: (_event, gesture) => {
        const maxX = maxPillX(barWidthRef.current, slotWidthRef.current, PILL_INSET);
        translateX.setValue(clamp(dragStart.current + gesture.dx, PILL_INSET, maxX));
        // 動いている速さに応じて横に伸ばす
        stretch.setValue(stretchForVelocity(gesture.vx));
      },
      // スクロール等に responder を奪われると Release が呼ばれず、押し込んだまま違う位置に残る
      onPanResponderTerminate: () => settleBackRef.current(),
      onPanResponderRelease: (_event, gesture) => {
        const slot = slotWidthRef.current;
        Animated.timing(press, { toValue: 1, duration: 140, useNativeDriver: false }).start();
        Animated.spring(stretch, { toValue: 1, useNativeDriver: false, speed: 12, bounciness: 10 }).start();
        if (slot <= 0) return;
        // 指を離した位置に一番近いタブへ寄せる（計算は lib/tab-pill.ts）
        const nearest = nearestTabIndex(pillX.current, gesture.vx, slot, PILL_INSET, visibleCountRef.current);
        // ＋投稿のスロットには寄せない（寄せると選択が変わらないままピルが残る）
        const target = nearestAllowedIndex(nearest, pillSlotsRef.current, Math.sign(gesture.dx));
        goToRef.current(target);
        Animated.spring(translateX, {
          toValue: pillRestX(target, slot, PILL_INSET),
          useNativeDriver: false,
          speed: 13,
          bounciness: 9,
        }).start();
      },
    }),
  ).current;

  // 描画中に ref を書かない（React の規則）。ハンドラは操作で呼ばれる = effect の後なので、ここで写して間に合う
  useEffect(() => {
    barWidthRef.current = barWidth;
    slotWidthRef.current = slotWidth;
    visibleCountRef.current = visible.length;
    pillSlotsRef.current = pillSlots;
    restXRef.current = restX;
    goToRef.current = goTo;
    settleBackRef.current = settleBack;
  });

  return (
    <View
      testID="glass-tab-bar"
      onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
      style={[
        {
          position: "absolute",
          left: space.lg,
          right: space.lg,
          bottom: TAB_BAR_BOTTOM_MARGIN,
          height: TAB_BAR_HEIGHT,
          borderRadius: radius.pill,
        },
        // 下に柔らかい影。ホワイトは shadow.card の不透明度が 0 で出ない（分岐を書かず値に任せる）
        shadow.card,
      ]}
      {...pan.panHandlers}
    >
      <GlassPane glass={glass} />

      {/* 選択中のピル（レンズ）。押している間は膨らんでバーの外へ出るので、overflow: hidden の GlassPane の外に置く */}
      {focusedVisible >= 0 && pillWidth > 0 && (
        <Animated.View
          testID="glass-pill"
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              // 項目と同じ枠（paddingTop の内側）で上下中央に置く（バー全体の中央だと 4px ずれる）
              top: space.sm + (TAB_BAR_HEIGHT - space.sm - PILL_HEIGHT) / 2,
              left: 0,
              width: pillWidth,
              height: PILL_HEIGHT,
              borderRadius: radius.pill,
              backgroundColor: glass.lensTint,
              borderWidth: 1,
              borderColor: glass.lensRim,
              transform: [{ translateX }, { scaleX: stretch }, { scale: press }],
            },
            // backdrop-filter を置かない（transform と同時だと Safari が背後を二重に描く。冒頭）
            webOnly({
              boxShadow: `inset 0 1px 0 ${glass.edgeHighlight}, inset 0 -1px 0 ${glass.edgeReflection}`,
            }),
          ]}
        />
      )}

      {/* 旧 tabBarStyle の paddingTop を持ち、項目は縦に伸ばす（alignItems: center だと項目が縮み、
          FAB の marginTop: -20 の起点が下がってはみ出しが 12px → 6px になる）。
          zIndex: 1: backdrop-filter を持つ兄弟（GlassPane）がこの列の上に来る WebKit の癖を抑える
          （Safari で FAB の下半分が覆われた） */}
      <View role="tablist" style={{ flex: 1, flexDirection: "row", paddingTop: space.sm, zIndex: 1 }}>
        {visible.map(({ route, index }, visibleIndex) => {
          const descriptor = descriptors[route.key];
          if (!descriptor) return null;
          const { options } = descriptor;
          const isFocused = state.index === index;
          const onPress = () => goTo(visibleIndex);

          // ＋投稿は tabBarButton（FAB）を持つ。見た目ごと呼び出し側に任せる
          if (options.tabBarButton) {
            const TabBarButton = options.tabBarButton;
            return (
              // tablist が直接持ってよいのは tab だけなので、＋投稿は role="none" の枠に入れる。
              // tabBarButton は関数として呼ばず要素として描く（中の hook がこの部品の hook の順序を壊さない）
              <View key={route.key} role="none" style={{ flex: 1, alignItems: "center" }}>
                <TabBarButton onPress={onPress}>{null}</TabBarButton>
              </View>
            );
          }

          const label = typeof options.title === "string" ? options.title : route.name;
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              // 外枠が tablist・項目が tab。react-native-web 0.21 は accessibilityState.selected を
              // aria-selected に写さないので直接渡す（accessibilityState はネイティブ向け）
              role="tab"
              aria-selected={isFocused}
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 2 }}
            >
              {options.tabBarIcon?.({
                focused: isFocused,
                color: isFocused ? colors.primary : colors.textMuted,
                size: 24,
              })}
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: fontFamily.ja,
                  color: isFocused ? colors.primary : colors.textMuted,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

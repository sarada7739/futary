import { fontFamily, radius, space, useTheme, type Glass } from "@futary/ui";
import type { Tabs } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
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

// 061: 湾曲ガラスのタブバー。
//
// 既定のタブバー（tabBarStyle に色を渡す形）では、ガラスに必要な層を積めない
// （backdrop-filter の層・屈折させる層・フチの層・レンズのピルで4枚要る）ため、
// Tabs の `tabBar` にこの部品を丸ごと渡す形に変えた。タブの項目・遷移・
// 状態管理は navigator のまま（この部品は state と descriptors を読むだけで、
// 自前の選択状態を持たない）。
//
// 【屈折が本物になるのは Chromium だけ】
// CSS には「背後の絵を歪ませる」手段が `backdrop-filter: url(#フィルタ)` しか
// 無く、これを実装しているのは Chromium だけ（WebKit・Firefox は url() を含む
// 宣言ごと捨てる）。そのため層を2枚に分けてある:
//   - ぼかしの層: blur と saturate だけ。url() を含めない。全ブラウザで効く
//   - 屈折の層  : backdrop-filter に url() だけを渡す。捨てられても上の層は残る
// 1つの宣言にまとめると、Safari が宣言ごと捨てたときにぼかしまで消える。
// Safari でも歪んで見えるのは「ガラス板そのもの」（下の屈折シート）の方で、
// こちらは通常の `filter: url()` のため全ブラウザで効く。
const PILL_HEIGHT = 44;
// スロットの中でピルが左右に残す余白
const PILL_INSET = 5;
// 押している間の膨らみ。バーからはみ出す（要件5）
const PRESS_SCALE = 1.12;
// これを超えて横に動いたらドラッグとして扱う。下回る動きはタップに渡す
const DRAG_THRESHOLD = 6;

// react-native-web にしか無い CSS プロパティを style に流すための包み
// （components/wheel-column.tsx の maskImage と同じ形。ネイティブでは null）
function webOnly(style: Record<string, string | number>): object | null {
  return Platform.OS === "web" ? (style as object) : null;
}

// `backdrop-filter: url(#...)` を実装しているか。UA では判定しない。
// Safari が構文としては受け付けて描画しない場合に備え、これが true でも
// ぼかしの層は別に持たせてある（上のコメント）
function supportsBackdropUrl(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
  try {
    return CSS.supports("backdrop-filter", "url(#nisoine-glass-pink)");
  } catch {
    return false;
  }
}

// タブのボタンとして出さない画面（(tabs)/_layout.tsx の思い出・統計など）の判定。
//
// `_layout.tsx` は `href: null` と書くが、**その項目は navigator まで届かない。**
// expo-router が手前で剥がし、代わりに `tabBarItemStyle: { display: "none" }` と
// 「null を返す tabBarButton」に置き換える（expo-router/build/layouts/TabsClient.js
// の withLayoutContext の processor）。`options.href` を見ても常に undefined で、
// 隠し画面が全部タブに並ぶ（実測: 12 画面ぶんの空きスロットが増え、本物のタブが
// 1/17 の幅に潰れた）。既定のタブバーと同じく `display: "none"` で判定する。
// StyleSheet.flatten は配列で渡された style も1つに畳む
function isHiddenFromTabBar(options: { tabBarItemStyle?: StyleProp<ViewStyle> }): boolean {
  return StyleSheet.flatten(options.tabBarItemStyle)?.display === "none";
}

/** ガラスの板。ぼかし・屈折・フチ・色収差を重ねる。中身（ピル・項目）は持たない */
function GlassPane({ glass, refracting }: { glass: Glass; refracting: boolean }) {
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
      {/* 2. 屈折。Chromium だけが効かせる。捨てられても 1 は残る */}
      {refracting && (
        <View
          testID="glass-refraction"
          style={[
            StyleSheet.absoluteFill,
            webOnly({
              backdropFilter: `url(#${glass.filterId})`,
              WebkitBackdropFilter: `url(#${glass.filterId})`,
            }),
          ]}
        />
      )}
      {/* 3. ガラス板そのもの。これ自体を filter で歪ませる（全ブラウザで効く）。
             左上が明るく右下が暗い斜めのグラデーションを持たせ、歪みが
             見える形を与える。無地だと歪ませても何も起きない */}
      <View
        testID="glass-sheet"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: glass.tint },
          webOnly({
            filter: `url(#${glass.filterId})`,
            WebkitFilter: `url(#${glass.filterId})`,
            backgroundImage:
              `linear-gradient(135deg, ${glass.edgeHighlight} 0%, transparent 28%, ` +
              `transparent 72%, ${glass.edgeReflection} 100%)`,
          }),
        ]}
      />
      {/* 4. 色収差。歪んだフチにだけ虹色を乗せる。inset の影を左右に振ると、
             端にしか出ない（中央には届かない）。ホワイトは aberration が 0 で
             この層自体を出さない（039「装飾は無い」） */}
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
      {/* 5. フチ。左上からの光と、反対側の弱い反射 */}
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

// expo-router は BottomTabBarProps という名前を公開していない（build/ 配下に
// しか無く、そこへ直接 import すると内部構成の変更で壊れる）。Tabs が受け取る
// `tabBar` の引数の型から引く。値としては import しない（型だけなので、この
// 部品は expo-router を実行時に読み込まない＝テストでモックが要らない）
export type GlassTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

export function GlassTabBar({ state, descriptors, navigation }: GlassTabBarProps) {
  const { colors, glass, shadow } = useTheme();
  const [barWidth, setBarWidth] = useState(0);
  const refracting = useMemo(supportsBackdropUrl, []);
  // レンズ（ピル）は板より強く曲げる。値はトークンから引く（architecture.md 7節）
  const lensFilter =
    `blur(${glass.lensBlurRadius}px) brightness(${glass.lensBrightness}) saturate(${glass.lensSaturate})`;

  // href: null の画面（思い出・統計など）はボタンとして出さない。
  // 既定のタブバーと同じ規則（(tabs)/_layout.tsx のコメント参照）
  const visible = state.routes
    .map((route, index) => ({ route, index }))
    .filter(({ route }) => {
      const options = descriptors[route.key]?.options;
      return options !== undefined && !isHiddenFromTabBar(options);
    });

  const focusedVisible = visible.findIndex(({ index }) => index === state.index);
  // ピルが乗ってよいスロット。＋投稿（tabBarButton）は選ばれた状態にならないため外す
  // （lib/tab-pill.ts の nearestAllowedIndex のコメント）
  const pillSlots = visible
    .map((entry, visibleIndex) => ({ entry, visibleIndex }))
    .filter(({ entry }) => descriptors[entry.route.key]?.options.tabBarButton === undefined)
    .map(({ visibleIndex }) => visibleIndex);
  const slotWidth = visible.length > 0 ? barWidth / visible.length : 0;
  const pillWidth = Math.max(slotWidth - PILL_INSET * 2, 0);

  const translateX = useRef(new Animated.Value(0)).current;
  const stretch = useRef(new Animated.Value(1)).current;
  const press = useRef(new Animated.Value(1)).current;
  // ドラッグ中に「今どこにいるか」を読むための写し。Animated.Value は
  // 同期で読めないため、listener で控える
  const pillX = useRef(0);
  const dragStart = useRef(0);

  // PanResponder は最初の描画で1度だけ作られ、その後は同じ関数が呼ばれ続ける。
  // ハンドラの中から今の値を読めるように写しを置く（クロージャが初回の値を
  // 抱えたままになるのを避ける）
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

  // 選択が変わったら（タブを押した・別画面から遷移した）スプリングで寄せる
  // 幅が測れていない間は動かさない。最初に測れたときは、左端から滑り込ませず
  // その位置から始める（onLayout は描画の後に来るため、springs だと毎回
  // 画面の左端からピルが飛んでくる）
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
    // ＋投稿（FAB）は listeners で preventDefault され、/compose を開く。
    // ここで navigate してしまうと二重に動く
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(target.route.name, target.route.params);
    }
  }

  // ドラッグを途中でやめた／奪われたときの後始末。押し込みと伸びを戻し、
  // 今選ばれているタブの上へピルを戻す
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
      // 横に DRAG_THRESHOLD を超えて動いたときだけ引き取る。
      // 下回る動きは項目の Pressable に渡す（タップを殺さない）
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
      // ブラウザのスクロール等に responder を奪われると Release は呼ばれない。
      // 何もしないと押し込んだまま・伸びたまま、選択と違う位置にピルが残る
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

  // 描画中に ref を書かない（React の規則）。PanResponder のハンドラは
  // 利用者の操作で呼ばれる＝コミットと effect のあとなので、ここで写して間に合う
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
        // 下に柔らかい影。ホワイトは shadow.card の不透明度が 0 で影が出ない
        // （039「影無し」。ここで外観の分岐を書かず、値に任せる）
        shadow.card,
      ]}
      {...pan.panHandlers}
    >
      <GlassPane glass={glass} refracting={refracting} />

      {/* 選択中のピル。ガラスの板の上に乗る「レンズ」。押している間は
          膨らんでバーの外へ出るため、overflow: hidden の GlassPane の外に置く */}
      {focusedVisible >= 0 && pillWidth > 0 && (
        <Animated.View
          testID="glass-pill"
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: (TAB_BAR_HEIGHT - PILL_HEIGHT) / 2,
              left: 0,
              width: pillWidth,
              height: PILL_HEIGHT,
              borderRadius: radius.pill,
              backgroundColor: glass.lensTint,
              borderWidth: 1,
              borderColor: glass.lensRim,
              transform: [{ translateX }, { scaleX: stretch }, { scale: press }],
            },
            webOnly({
              backdropFilter: lensFilter,
              WebkitBackdropFilter: lensFilter,
              boxShadow: `inset 0 1px 0 ${glass.edgeHighlight}, inset 0 -1px 0 ${glass.edgeReflection}`,
            }),
          ]}
        />
      )}

      <View role="tablist" style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
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
              // tablist が直接持ってよいのは tab だけ。＋投稿はタブではないため
              // role="none" の枠に入れて、支援技術から「壊れた tablist」に
              // 見えないようにする。
              // tabBarButton は関数として呼ばず要素として描く（中で hook が
              // 使われたとき、この部品の hook の順序を壊さないため）
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
              // タブの並びとしての意味を持たせる（外枠が tablist・項目が tab）。
              // react-native-web 0.21 は accessibilityState.selected を
              // aria-selected に写さないため、aria-selected を直接渡す。
              // accessibilityState はネイティブ向けに残す
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

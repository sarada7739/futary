import { colors, iconFabPlus, iconTabCalendar, iconTabHome, iconTabProfile, iconTabTimeline, shadow, space } from "@futary/ui";
import { Tabs, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Image, type ImageSourcePropType, Pressable, View } from "react-native";
import { useGuestMode } from "../../lib/guest-mode";

// 002 の絵文字代用を、docs/sample/透過素材/dnUunrHG.png から切り出したアイコンに
// 差し替え（008）。単色の線画のため tintColor でアクティブ/非アクティブを塗り分ける。
// 「アルバム」タブは「カレンダー」に置き換えた（fix/persistent-tab-bar）。
// 「検索」タブは「タイムライン」に置き換えた（020。requirements.md 5節のとおり
// 検索はスコープ外のままで、タブの枠自体を持たなくなった。L71が解消する）
const tabIcons: Record<string, ImageSourcePropType> = {
  index: iconTabHome,
  calendar: iconTabCalendar,
  timeline: iconTabTimeline,
  profile: iconTabProfile,
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  return (
    <Image
      source={tabIcons[name]}
      style={{ width: 24, height: 24, tintColor: focused ? colors.primary : colors.textMuted }}
      resizeMode="contain"
    />
  );
}

// この1箇所でしか使わない寸法のためトークン化はしない（002の判断を維持）。
// borderRadius はここから半径を導出し、2つの数値が別々にずれないようにする
const FAB_SIZE = 56;

/** 中央の「＋投稿」タブ。丸いFABとして浮かせる。押すと投稿作成モーダルを開く */
function FabTabButton({
  children,
  onPress,
}: {
  children?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          marginTop: -20,
          borderRadius: FAB_SIZE / 2,
          opacity: pressed ? 0.85 : 1,
          ...shadow.fab,
        })}
      >
        <Image
          source={iconFabPlus}
          style={{ width: FAB_SIZE, height: FAB_SIZE }}
          resizeMode="contain"
        />
      </Pressable>
      {children}
    </View>
  );
}

export default function TabsLayout() {
  const router = useRouter();
  const { isGuestMode, exitGuestMode } = useGuestMode();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64,
          paddingTop: space.sm,
        },
        tabBarLabelStyle: { fontSize: 11 },
        tabBarItemStyle: { flex: 1 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "ホーム",
          tabBarIcon: ({ focused }) => <TabIcon name="index" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "カレンダー",
          tabBarIcon: ({ focused }) => <TabIcon name="calendar" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="post"
        options={{
          title: "",
          tabBarButton: (props) => <FabTabButton onPress={props.onPress as () => void} />,
        }}
        listeners={{
          // タブ切り替えではなく /compose をモーダルで開く。post.tsx は
          // このリスナーで常に preventDefault されるため実際には表示されない。
          // 014: デモ閲覧中は投稿できない（サーバ側でFORBIDDENになる）ため、
          // FABはログイン導線に差し替える（押すとサインイン画面へ戻る）
          tabPress: (e) => {
            e.preventDefault();
            if (isGuestMode) {
              exitGuestMode();
              return;
            }
            router.push("/compose");
          },
        }}
      />
      <Tabs.Screen
        name="timeline"
        options={{
          title: "タイムライン",
          tabBarIcon: ({ focused }) => <TabIcon name="timeline" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "マイページ",
          tabBarIcon: ({ focused }) => <TabIcon name="profile" focused={focused} />,
        }}
      />
      {/* 020: ホームの機能パネル「思い出」「統計」の行き先。href: null で
          タブバーのボタンとしては出さないが、(tabs)navigator の内側に置くことで
          遷移してもタブバーが消えない（Rレビュー指摘。L70でcalendar.tsxが
          (tabs)の外にありタブが消えた不具合と同じ構造を、ここでも踏んでいた） */}
      <Tabs.Screen name="memory" options={{ href: null, headerShown: true, title: "思い出" }} />
      <Tabs.Screen name="stats" options={{ href: null, headerShown: true, title: "統計" }} />
    </Tabs>
  );
}

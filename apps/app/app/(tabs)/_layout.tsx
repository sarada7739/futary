import { colors, iconFabPlus, iconTabCalendar, iconTabHome, iconTabProfile, iconTabTimeline, shadow, space } from "@futary/ui";
import { Tabs, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Image, type ImageSourcePropType, Pressable, View } from "react-native";

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
        style={({ pressed }) => ({ marginTop: -20, opacity: pressed ? 0.85 : 1, ...shadow.fab })}
      >
        <Image source={iconFabPlus} style={{ width: 56, height: 56 }} resizeMode="contain" />
      </Pressable>
      {children}
    </View>
  );
}

export default function TabsLayout() {
  const router = useRouter();

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
          // このリスナーで常に preventDefault されるため実際には表示されない
          tabPress: (e) => {
            e.preventDefault();
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
    </Tabs>
  );
}

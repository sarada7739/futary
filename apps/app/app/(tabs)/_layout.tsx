import { colors, radius, shadow, space, Text } from "@futary/ui";
import { Tabs } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

/** タブアイコン代わりの絵文字。トークンに定義がないため文字列のまま扱う */
const tabIcons: Record<string, string> = {
  index: "🏠",
  album: "🖼️",
  search: "🔍",
  profile: "👤",
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  return (
    <Text size="lg" color={focused ? "brand" : "muted"}>
      {tabIcons[name]}
    </Text>
  );
}

/** 中央の「＋投稿」タブ。丸いFABとして浮かせる */
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
          width: 56,
          height: 56,
          borderRadius: radius.pill,
          backgroundColor: pressed ? colors.primaryPressed : colors.primary,
          alignItems: "center",
          justifyContent: "center",
          marginTop: -20,
          ...shadow.fab,
        })}
      >
        <Text size="xl" weight="bold" color="inverse">
          ＋
        </Text>
      </Pressable>
      {children}
    </View>
  );
}

export default function TabsLayout() {
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
        name="album"
        options={{
          title: "アルバム",
          tabBarIcon: ({ focused }) => <TabIcon name="album" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="post"
        options={{
          title: "",
          tabBarButton: (props) => (
            <FabTabButton onPress={props.onPress as () => void} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "検索",
          tabBarIcon: ({ focused }) => <TabIcon name="search" focused={focused} />,
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

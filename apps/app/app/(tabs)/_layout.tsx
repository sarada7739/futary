import { FabIcon, iconTabCalendar, iconTabHome, iconTabProfile, iconTabTimeline, useTheme } from "@futary/ui";
import { Tabs, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Image, type ImageSourcePropType, Pressable, View } from "react-native";
import { useGuestMode } from "../../lib/guest-mode";
import { GlassTabBar } from "../../components/glass-tab-bar";

// タブのアイコンは単色の線画なので tintColor でアクティブ/非アクティブを塗り分ける。
// 検索はスコープ外なのでタブを持たない（requirements.md 5節）
const tabIcons: Record<string, ImageSourcePropType> = {
  index: iconTabHome,
  calendar: iconTabCalendar,
  timeline: iconTabTimeline,
  profile: iconTabProfile,
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const { colors } = useTheme();
  return (
    <Image
      source={tabIcons[name]}
      style={{ width: 24, height: 24, tintColor: focused ? colors.primary : colors.textMuted }}
      resizeMode="contain"
    />
  );
}

// この 1 箇所でしか使わない寸法なのでトークンにしない。borderRadius は半径から出す（2 つの値を別々にずらさない）
const FAB_SIZE = 56;

/** 中央の「＋投稿」。丸い FAB として浮かせ、押すと投稿のモーダルを開く */
function FabTabButton({
  children,
  onPress,
}: {
  children?: ReactNode;
  onPress?: () => void;
}) {
  const { shadow } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          marginTop: -20,
          borderRadius: FAB_SIZE / 2,
          opacity: pressed ? 0.85 : 1,
          // FAB の光彩。アバターのリングと同じ見た目（shadow.glow。同じ見た目に 2 つの名前を付けない）
          ...shadow.glow,
        })}
      >
        {/* 絵は FabIcon が外観で描き分ける（ピンクは画像、ホワイトは黒い円） */}
        <FabIcon size={FAB_SIZE} />
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
      // タブバーの見た目は GlassTabBar が全部持つ（層が複数要り、tabBarStyle 1 枚では積めない）。
      // ここに残すのは「何を出すか」だけ。色も GlassTabBar が useTheme() から引く
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
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
          // タブ切り替えでなく /compose をモーダルで開く（post.tsx は常に preventDefault されて表示されない）。
          // デモ閲覧中は投稿できないので、ログインの導線に替える
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
      {/* ホームの機能パネルの行き先。href: null でタブのボタンに出さないが、(tabs) の内側に置くので
          遷移してもタブバーが消えない（外に置くと消える）。以下の href: null も同じ理由 */}
      <Tabs.Screen name="memory" options={{ href: null, headerShown: true, title: "思い出" }} />
      <Tabs.Screen name="stats" options={{ href: null, headerShown: true, title: "統計" }} />
      {/* 機能パネル「リスト」 */}
      <Tabs.Screen name="list" options={{ href: null, headerShown: true, title: "リスト" }} />
      {/* 機能パネル「気分の記録」 */}
      <Tabs.Screen name="mood" options={{ href: null, headerShown: true, title: "気分の記録" }} />
      {/* マイページの「アカウントを削除」 */}
      <Tabs.Screen name="delete-account" options={{ href: null, headerShown: true, title: "アカウントを削除" }} />
      {/* 機能パネル「ほしいもの」 */}
      <Tabs.Screen name="want" options={{ href: null, headerShown: true, title: "ほしいもの" }} />
      {/* 機能パネル「AIまとめ」 */}
      <Tabs.Screen name="ai-summary" options={{ href: null, headerShown: true, title: "AIまとめ" }} />
      {/* 機能パネル「アルバム」の一覧と詳細（`?id=`。動的ルートは静的書き出しの前提を崩すので使わない）。
          詳細の題名は画面が setOptions で上書きする */}
      <Tabs.Screen name="album" options={{ href: null, headerShown: true, title: "アルバム" }} />
      <Tabs.Screen name="album-detail" options={{ href: null, headerShown: true, title: "アルバム" }} />
      {/* 「リリース履歴を見る」。戻るは画面が setOptions で置く */}
      <Tabs.Screen name="releases" options={{ href: null, headerShown: true, title: "リリース履歴" }} />
      {/* プレミアムの案内（一覧の使用量・詳細の警告と上限のシート・マイページから）。戻るは画面が置く */}
      <Tabs.Screen name="premium" options={{ href: null, headerShown: true, title: "プレミアム" }} />
      {/* 運営の画面。マイページの「運営 ›」（isAdmin のときだけ）から */}
      <Tabs.Screen name="admin" options={{ href: null, headerShown: true, title: "運営" }} />
    </Tabs>
  );
}

import { Card, Screen, space, Text } from "@futary/ui";
import { useQuery } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { Image, View } from "react-native";
import logo from "../../assets/logo.png";
import { orpc } from "../../lib/orpc";

/** ロゴ画像のアスペクト比（204x112）に合わせた表示サイズ */
const LOGO_WIDTH = 106;
const LOGO_HEIGHT = 58;

export default function HomeScreen() {
  const { data, isLoading, isError, error } = useQuery(
    orpc.health.get.queryOptions(),
  );

  return (
    <Screen>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Image
          source={logo}
          style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
          resizeMode="contain"
        />
        <Card>
          {isLoading && <Text color="muted">読み込み中…</Text>}
          {isError && (
            <Text testID="health-error">
              通信エラー: {error instanceof Error ? error.message : String(error)}
            </Text>
          )}
          {data && (
            <View testID="health-result">
              <Text>ok: {String(data.ok)}</Text>
              <Text color="muted">now: {new Date(data.now).toISOString()}</Text>
            </View>
          )}
        </Card>
      </View>
      <StatusBar style="auto" />
    </Screen>
  );
}

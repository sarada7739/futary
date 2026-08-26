import { Card, Screen, Text } from "@futary/ui";
import { useQuery } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { Image, View } from "react-native";
import logo from "../../assets/logo.png";
import { orpc } from "../../lib/orpc";

export default function HomeScreen() {
  const { data, isLoading, isError, error } = useQuery(
    orpc.health.get.queryOptions(),
  );

  return (
    <Screen>
      <View style={{ padding: 16, gap: 12 }}>
        <Image
          source={logo}
          style={{ width: 132, height: 58 }}
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

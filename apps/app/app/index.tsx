import { useQuery } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { orpc } from "../lib/orpc";

export default function HomeScreen() {
  const { data, isLoading, isError, error } = useQuery(
    orpc.health.get.queryOptions(),
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>futary</Text>
      {isLoading && <Text>読み込み中…</Text>}
      {isError && (
        <Text testID="health-error">
          通信エラー: {error instanceof Error ? error.message : String(error)}
        </Text>
      )}
      {data && (
        <View testID="health-result">
          <Text>ok: {String(data.ok)}</Text>
          <Text>now: {new Date(data.now).toISOString()}</Text>
        </View>
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  title: {
    fontSize: 24,
    marginBottom: 16,
  },
});

import { Screen, space } from "@futary/ui";
import { ScrollView } from "react-native";
import { MemoryCard } from "../../components/memory-card";

// 020: 013の思い出しカードをホームから独立したページへ移した。
// ホームの機能パネル「思い出」の行き先。新しいカードは作らず、
// 既存のMemoryCardをそのまま出す（タスク定義「新しく作らない」）
export default function MemoryScreen() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <MemoryCard />
      </ScrollView>
    </Screen>
  );
}

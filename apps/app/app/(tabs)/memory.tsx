import { Screen, space } from "@futary/ui";
import { ScrollView } from "react-native";
import { MemoryCard } from "../../components/memory-card";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";

// 機能パネル「思い出」の行き先。MemoryCard をそのまま出す
export default function MemoryScreen() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE }}>
        <MemoryCard />
      </ScrollView>
    </Screen>
  );
}

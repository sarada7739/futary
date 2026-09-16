import { Pressable, View } from "react-native";
import { Card, space, Text } from "@futary/ui";
import type { LockNotice } from "../lib/plan";

// 047: プレミアムをやめたあとの帯（タスク定義 2節）。アルバム一覧（使用量のカードの上）・アルバム詳細・
// マイページの 3 箇所で同じものを出す。
// 猶予中: 文 + 「ZIP で保存」（048 段階1 のシート）+ 「プレミアムについて」。鍵の後: 文 + 「プレミアムについて」

export type LockBandProps = {
  notice: LockNotice;
  // 詳細では短く（1 行目だけ）。呼び出し側が文を渡す
  text?: string;
  onZip: () => void;
  onPremium: () => void;
};

export function LockBand({ notice, text, onZip, onPremium }: LockBandProps) {
  return (
    <Card testID={`lock-band-${notice.kind}`}>
      <View style={{ gap: space.sm }}>
        <Text size="sm" testID="lock-band-text">
          {text ?? notice.text}
        </Text>
        <View style={{ flexDirection: "row", gap: space.lg, flexWrap: "wrap" }}>
          {notice.kind === "grace" && (
            <Pressable accessibilityRole="button" accessibilityLabel="ZIP で保存" onPress={onZip} hitSlop={space.sm} testID="lock-band-zip">
              <Text size="sm" weight="medium" color="brand">
                ZIP で保存 ›
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="プレミアムについて"
            onPress={onPremium}
            hitSlop={space.sm}
            testID="lock-band-premium"
          >
            <Text size="sm" weight="medium" color="brand">
              プレミアムについて ›
            </Text>
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

import { View } from "react-native";
import type { Stats } from "@futary/contract";
import { Avatar, Card, colors, space, Text } from "@futary/ui";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/orpc";

const AVATAR_SIZE = 56;

type Member = Stats["members"][number];

// 相手が未参加（招待中）のときは点線の枠だけを出す。実在するアバターと
// 混同しないよう、Avatarコンポーネントは使わずここだけ別の見た目にする
function InvitingAvatar() {
  return (
    <View style={{ alignItems: "center", gap: space.xs }}>
      <View
        style={{
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
          borderRadius: AVATAR_SIZE / 2,
          borderWidth: 1,
          borderColor: colors.border,
          borderStyle: "dashed",
          backgroundColor: colors.surfaceTint,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text size="xs" color="muted">
          招待中
        </Text>
      </View>
    </View>
  );
}

function MemberAvatar({ member }: { member?: Member }) {
  if (!member) return <InvitingAvatar />;

  const name = member.name ?? "（名前未設定）";
  return (
    <View style={{ alignItems: "center", gap: space.xs }}>
      <Avatar name={name} imageUrl={member.image ?? undefined} size={AVATAR_SIZE} />
      <Text size="xs" color="muted">
        {name}
      </Text>
    </View>
  );
}

function daysTogetherLabel(daysTogether: Stats["daysTogether"]): string {
  if (daysTogether.status === "together") return `付き合って ${daysTogether.days}日目`;
  return `記念日まで あと${daysTogether.days}日`;
}

export function StatsCard() {
  const query = useQuery(orpc.stats.get.queryOptions());

  // 通信エラー時はカード自体を出さない（ホーム画面の主役は投稿一覧のため、
  // 統計カードの失敗で画面全体を止めない）
  if (query.isError) return null;

  if (query.isLoading || !query.data) {
    return (
      <Card>
        <View style={{ alignItems: "center", gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
            <View
              style={{
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: AVATAR_SIZE / 2,
                backgroundColor: colors.surfaceTint,
              }}
            />
            <Text size="lg" color="muted">
              ♥
            </Text>
            <View
              style={{
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: AVATAR_SIZE / 2,
                backgroundColor: colors.surfaceTint,
              }}
            />
          </View>
          <Text size="xl" weight="bold" color="muted">
            ―
          </Text>
        </View>
      </Card>
    );
  }

  const stats = query.data;

  return (
    <Card>
      <View style={{ alignItems: "center", gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
          <MemberAvatar member={stats.members[0]} />
          <Text size="lg" color="brand">
            ♥
          </Text>
          <MemberAvatar member={stats.members[1]} />
        </View>
        <View style={{ alignItems: "center" }}>
          <Text size="xl" weight="bold" color="brand">
            {daysTogetherLabel(stats.daysTogether)}
          </Text>
          <Text size="sm" color="muted">
            会った回数：{stats.meetupCount}回
          </Text>
        </View>
      </View>
    </Card>
  );
}

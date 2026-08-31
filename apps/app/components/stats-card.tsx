import { Pressable, View } from "react-native";
import type { Stats } from "@futary/contract";
import { Avatar, Button, Card, colors, space, Text } from "@futary/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { daysTogetherLabel } from "../lib/stats";
import { orpc } from "../lib/orpc";
import { useViewerQueryKey } from "../lib/viewer-key";

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

export function StatsCard() {
  const router = useRouter();
  // queryKeyにviewerKeyを含める理由はapps/app/lib/viewer-key.ts参照（T9）
  const viewerKey = useViewerQueryKey();
  const query = useQuery({
    ...orpc.stats.get.queryOptions(),
    queryKey: [...orpc.stats.get.queryOptions().queryKey, viewerKey],
  });

  // 016: 以前は通信エラー時にカード自体を消していたが、それだと利用者に
  // 何も知らされないまま統計情報だけが欠ける（security-auditor全体監査・
  // 3状態レビュー指摘）。カードは出したまま再試行できる表示に変える。
  // ホーム画面の他の要素（機能パネル）は取得状態に依存しないため、
  // このカードの失敗が画面全体を止めることはない
  if (query.isError) {
    return (
      <Card>
        <View style={{ alignItems: "center", gap: space.md }}>
          <Text color="muted">記念日を読み込めませんでした</Text>
          <Button
            onPress={async () => {
              await query.refetch();
            }}
          >
            再試行
          </Button>
        </View>
      </Card>
    );
  }

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
          {daysTogetherLabel(stats.daysTogether) && (
            <Text size="xl" weight="bold" color="brand">
              {daysTogetherLabel(stats.daysTogether)}
            </Text>
          )}
          {/* 023: unset（まだ決めていない）のときだけマイページへの導線を出す。
              hidden（本人が隠すと決めた）のときは何も出さない
              （同じにすると隠すと決めた人に「設定してください」と出し続けることになる） */}
          {stats.daysTogether.status === "unset" && (
            <Pressable onPress={() => router.push("/profile")} testID="stats-card-set-dating-date">
              <Text size="sm" color="brand">
                付き合った日を設定する
              </Text>
            </Pressable>
          )}
          <Text size="sm" color="muted">
            会った日数：{stats.meetupDays}日
          </Text>
        </View>
      </View>
    </Card>
  );
}

import type { ReactNode } from "react";
import { Image, Text as RNText, Pressable, View } from "react-native";
import type { Stats } from "@futary/contract";
import { Avatar, Badge, Button, Card, colors, fontFamily, radius, shadow, space, sparkle, Text } from "@futary/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { daysTogetherParts } from "../lib/stats";
import { orpc } from "../lib/orpc";
import { useViewerQueryKey } from "../lib/viewer-key";

// 035視覚仕様1節「アバター」表の数値
const AVATAR_SIZE = 80;
const AVATAR_GLOW_RING = 3; // packages/ui Avatarのglow時の縁の太さと同じ値（86=80+3*2）
const AVATAR_CENTER_DISTANCE = 128;
const HEART_SIZE = 40;
const HEART_ICON_SIZE = 22;
const SPARKLE_SIZE = 16;

type Member = Stats["members"][number];

// 相手が未参加（招待中）のときは点線の枠だけを出す。実在するアバターと
// 混同しないよう、Avatarコンポーネントは使わずここだけ別の見た目にする
function InvitingAvatar() {
  return (
    <View style={{ alignItems: "center" }}>
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

// 035視覚仕様1節: 名前は12pt/weight500/text（mutedは薄すぎる）、アバター下8
function MemberAvatar({ member }: { member?: Member }) {
  if (!member) return <InvitingAvatar />;

  const name = member.name ?? "（名前未設定）";
  return (
    <View style={{ alignItems: "center" }}>
      <Avatar name={name} imageUrl={member.image ?? undefined} size={AVATAR_SIZE} glow />
      {/* 035書体仕様3節: 「ゆい／れん」はweight400（Poppinsを混植しない
          日本語要素）*/}
      <RNText style={{ fontFamily: fontFamily.ja, fontSize: 12, fontWeight: "400", color: colors.text, marginTop: space.sm }}>
        {name}
      </RNText>
    </View>
  );
}

// 記念日カードの地。`Card`はpaddingが固定（space.lg）でここには合わないため
// 使わず、同じトークン（radius.card・shadow.card）に035の値（半透明・上端の縁）
// を足して直接組み立てる
function CardShell({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        borderRadius: radius.card,
        paddingVertical: 20,
        paddingHorizontal: 16,
        backgroundColor: "rgba(255, 255, 255, 0.6)", // surface(#FFFFFF) opacity 0.6
        borderTopWidth: 1,
        borderTopColor: "rgba(255, 255, 255, 0.8)", // surface opacity 0.8
        overflow: "hidden",
        ...shadow.card,
      }}
    >
      {children}
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
  const parts = daysTogetherParts(stats.daysTogether);

  return (
    <CardShell>
      <View style={{ alignItems: "center" }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "center",
            // 中心間128（視覚仕様1節）。アバター外径86（80+glowの縁3*2）なので
            // 隙間は128-86=42。ハート40を挟んだ残りをavatar-heart間で等分する
            columnGap: (AVATAR_CENTER_DISTANCE - (AVATAR_SIZE + AVATAR_GLOW_RING * 2) - HEART_SIZE) / 2,
          }}
        >
          <MemberAvatar member={stats.members[0]} />
          <View
            style={{
              width: HEART_SIZE,
              height: HEART_SIZE,
              borderRadius: HEART_SIZE / 2,
              backgroundColor: "rgba(255, 255, 255, 0.85)", // surface opacity 0.85
              alignItems: "center",
              justifyContent: "center",
              // アバター外径86の縦中央に来るよう、その半分からハート半分を引く
              marginTop: (AVATAR_SIZE + AVATAR_GLOW_RING * 2 - HEART_SIZE) / 2,
              ...shadow.glow,
            }}
          >
            <RNText style={{ fontSize: HEART_ICON_SIZE, color: colors.primary }}>♥</RNText>
          </View>
          <MemberAvatar member={stats.members[1]} />
        </View>

        {parts && (
          <>
            {/* 035書体仕様3節: 「付き合って」はweight400（日本語。Poppins混植しない） */}
            <RNText
              testID="stats-card-days-prefix"
              style={{
                fontFamily: fontFamily.ja,
                fontSize: 14,
                fontWeight: "400",
                color: colors.text,
                lineHeight: 20,
                marginTop: space.md,
              }}
            >
              {parts.prefix}
            </RNText>
            <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
              <View>
                {/* 035書体仕様2節・4節: 「数字が主役の箱」。Poppins weight800
                    （700との実測比較をAの指示で行い、800を採用した） */}
                <RNText
                  testID="stats-card-days-number"
                  style={{
                    fontFamily: fontFamily.numeric,
                    fontSize: 72,
                    fontWeight: "800",
                    lineHeight: 76,
                    letterSpacing: -2,
                    color: colors.text,
                    fontVariant: ["tabular-nums"],
                    includeFontPadding: false,
                  }}
                >
                  {parts.days}
                </RNText>
                <Image
                  source={sparkle}
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -SPARKLE_SIZE / 2,
                    width: SPARKLE_SIZE,
                    height: SPARKLE_SIZE,
                    opacity: 0.9,
                  }}
                  resizeMode="contain"
                />
              </View>
              <RNText
                testID="stats-card-days-suffix"
                style={{
                  fontFamily: fontFamily.ja,
                  fontSize: 18,
                  fontWeight: "700",
                  color: colors.brandInk,
                  marginLeft: 4,
                  paddingBottom: 10,
                }}
              >
                {parts.suffix}
              </RNText>
            </View>
          </>
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

        {/* 035視覚仕様1節: 会った日数はピル。「94」だけprimary/weight700。
            Badgeはstyleを受け取らないため、間隔は外側のViewで付ける */}
        <View style={{ marginTop: space.sm }}>
          <Badge>
            {/* 035書体仕様: 「会った日数」「日」はweight400（日本語）、
                数字だけPoppins weight500（数字が主役の箱） */}
            <RNText
              testID="stats-card-meetup-pill"
              style={{ fontFamily: fontFamily.ja, fontSize: 12, fontWeight: "400", color: colors.text }}
            >
              会った日数：
              <RNText
                style={{
                  fontFamily: fontFamily.numeric,
                  color: colors.primary,
                  fontWeight: "500",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {stats.meetupDays}
              </RNText>
              日
            </RNText>
          </Badge>
        </View>
      </View>
    </CardShell>
  );
}

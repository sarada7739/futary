import type { ReactNode } from "react";
import { Image, Text as RNText, Pressable, View } from "react-native";
import type { Stats } from "@futary/contract";
import { Avatar, Badge, Button, Card, fontFamily, radius, space, sparkle, Text, useTheme } from "@futary/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { daysTogetherParts } from "../lib/stats";
import { orpc } from "../lib/orpc";
import { useViewerQueryKey } from "../lib/viewer-key";

// アバターの寸法（035）
const AVATAR_SIZE = 80;
const AVATAR_GLOW_RING = 3; // packages/ui Avatarのglow時の縁の太さと同じ値（86=80+3*2）
const AVATAR_CENTER_DISTANCE = 128;
const HEART_SIZE = 40;
const HEART_ICON_SIZE = 22;
const SPARKLE_SIZE = 16;
// ホワイトはハートもリングも無いので外径 80 のまま。中心間 128 を保つと隙間は 48（039）
const WHITE_AVATAR_GAP = AVATAR_CENTER_DISTANCE - AVATAR_SIZE;

type Member = Stats["members"][number];

// 相手が未参加（招待中）なら点線の枠だけ。実在のアバターと混同しないよう Avatar は使わない
function InvitingAvatar() {
  const { colors } = useTheme();
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

// 名前は 12pt・weight 500・text（muted は薄すぎる）。アバターの下 8
function MemberAvatar({ member }: { member?: Member }) {
  const { appearance, colors } = useTheme();
  if (!member) return <InvitingAvatar />;

  const name = member.name ?? "（名前未設定）";
  // ホワイトはリング無しの素の円（glow はピンクの語彙）
  return (
    <View style={{ alignItems: "center" }}>
      <Avatar name={name} imageUrl={member.image ?? undefined} size={AVATAR_SIZE} glow={appearance === "pink"} />
      {/* 名前は weight 400（日本語。Poppins を混ぜない） */}
      <RNText style={{ fontFamily: fontFamily.ja, fontSize: 12, fontWeight: "400", color: colors.text, marginTop: space.sm }}>
        {name}
      </RNText>
    </View>
  );
}

// 記念日カードの地。Card は padding が固定で合わないので、同じトークン（radius.card・shadow.card）に
// 半透明・上端の縁を足して組む
function CardShell({ children }: { children: ReactNode }) {
  const { appearance, colors, shadow } = useTheme();
  // ホワイトは半透明の地・縁・影を使わず、Card と同じ「surface の地 + border 1px」（影は値で 0）
  const surface =
    appearance === "white"
      ? { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }
      : {
          backgroundColor: "rgba(255, 255, 255, 0.6)", // surface(#FFFFFF) opacity 0.6
          borderTopWidth: 1,
          borderTopColor: "rgba(255, 255, 255, 0.8)", // surface opacity 0.8
        };
  return (
    <View
      testID={appearance === "white" ? "stats-card-shell-white" : undefined}
      style={{
        borderRadius: radius.card,
        paddingVertical: 20,
        paddingHorizontal: 16,
        ...surface,
        overflow: "hidden",
        ...shadow.card,
      }}
    >
      {children}
    </View>
  );
}

export function StatsCard() {
  const { appearance, colors, shadow } = useTheme();
  const isWhite = appearance === "white";
  const router = useRouter();
  // queryKey に viewerKey を含める（lib/viewer-key.ts。T9）
  const viewerKey = useViewerQueryKey();
  const query = useQuery({
    ...orpc.stats.get.queryOptions(),
    queryKey: [...orpc.stats.get.queryOptions().queryKey, viewerKey],
  });

  // 通信エラーでもカードは消さず、再試行できる表示にする（消すと何も知らされず統計だけ欠ける）。
  // 機能パネルは取得状態に依存しないので、この失敗が画面全体を止めない
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
            {!isWhite && (
              <Text size="lg" color="muted">
                ♥
              </Text>
            )}
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
            // 中心間 128。外径 86（80 + glow の縁 3×2）なので隙間は 42 で、ハート 40 を挟んだ残りを等分する。
            // ホワイトはハートもリングも無いので 48 を 1 つの隙間に
            columnGap: isWhite
              ? WHITE_AVATAR_GAP
              : (AVATAR_CENTER_DISTANCE - (AVATAR_SIZE + AVATAR_GLOW_RING * 2) - HEART_SIZE) / 2,
          }}
        >
          <MemberAvatar member={stats.members[0]} />
          {/* 2 人の間のハートはピンクだけ。ホワイトは余白だけ（039） */}
          {!isWhite && (
          <View
            testID="stats-card-heart"
            style={{
              width: HEART_SIZE,
              height: HEART_SIZE,
              borderRadius: HEART_SIZE / 2,
              backgroundColor: "rgba(255, 255, 255, 0.85)", // surface opacity 0.85
              alignItems: "center",
              justifyContent: "center",
              // 外径 86 の縦中央に来るよう、その半分からハートの半分を引く
              marginTop: (AVATAR_SIZE + AVATAR_GLOW_RING * 2 - HEART_SIZE) / 2,
              ...shadow.glow,
            }}
          >
            <RNText style={{ fontSize: HEART_ICON_SIZE, color: colors.primary }}>♥</RNText>
          </View>
          )}
          <MemberAvatar member={stats.members[1]} />
        </View>

        {parts && (
          <>
            {/* 「付き合って」は weight 400（日本語。Poppins を混ぜない）。ホワイトは小見出しを出さないが、
                「記念日まで あと」は数字の意味そのもの（未来の日付）なので残す */}
            {(!isWhite || (stats.daysTogether.status !== "dating" && stats.daysTogether.status !== "married")) && (
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
            )}
            <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: isWhite ? space.md : 0 }}>
              <View>
                {/* 数字が主役の箱。Poppins weight 800 */}
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
                {/* スパークルはピンクの装飾。ホワイトには無い */}
                {!isWhite && (
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
                )}
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

        {/* unset（まだ決めていない）のときだけマイページへの導線を出す。hidden（本人が隠すと決めた）では
            出さない（隠すと決めた人に「設定してください」と出し続けない。023） */}
        {stats.daysTogether.status === "unset" && (
          <Pressable onPress={() => router.push("/profile")} testID="stats-card-set-dating-date">
            <Text size="sm" color="brand">
              付き合った日を設定する
            </Text>
          </Pressable>
        )}

        {/* 会った日数はピル（ホワイトは素の muted の文字）。「94」だけ primary・weight 700。
            Badge は style を受け取らないので、間隔は外側の View で付ける */}
        {isWhite ? (
          <RNText
            testID="stats-card-meetup-plain"
            style={{ fontFamily: fontFamily.ja, fontSize: 13, fontWeight: "400", color: colors.textMuted, marginTop: space.sm }}
          >
            会った日数：{stats.meetupDays}日
          </RNText>
        ) : (
        <View style={{ marginTop: space.sm }}>
          <Badge>
            {/* 「会った日数」「日」は weight 400（日本語）、数字だけ Poppins weight 500 */}
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
        )}
      </View>
    </CardShell>
  );
}

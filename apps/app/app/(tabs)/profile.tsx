import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Share, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ORPCError } from "@orpc/client";
import { formatJstDateTime } from "@futary/date";
import { PRIMARY_DATE_VALUES, type Couple } from "@futary/contract";
import { lockNotice, paidPlanLabel, planLabel } from "../../lib/plan";
import {
  APPEARANCE_VALUES,
  Avatar,
  Button,
  Card,
  radius,
  Screen,
  space,
  Text,
  useAppearance,
  useTheme,
  type Appearance,
} from "@futary/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { DateInput8 } from "../../components/date-input8";
import { LegalLinks } from "../../components/legal-links";
import { LockBand } from "../../components/lock-band";
import { WeatherAreaSheet } from "../../components/weather-area-sheet";
import { ZipExportSheet } from "../../components/zip-export-sheet";
import type { ZipSource } from "../../lib/album-zip";
import { compressImage, uploadCompressedImage, type SourceImage } from "../../lib/image";
import { useGuestMode } from "../../lib/guest-mode";
import { orpc } from "../../lib/orpc";
import { queryClient } from "../../lib/query";
import { signOut } from "../../lib/auth-client";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME_LENGTH = 20;

type PrimaryDate = Couple["primaryDate"];

// ホーム上部に何を表示するか。ラベルはこの画面だけで使うので共有の lib に出さない（019）
const PRIMARY_DATE_LABELS: Record<PrimaryDate, string> = {
  dating: "付き合った日",
  married: "結婚した日",
  none: "非表示",
};

// 見た目（ピンク/ホワイト）。ラベルはこの画面だけで使う（039）
const APPEARANCE_LABELS: Record<Appearance, string> = {
  pink: "ピンク",
  white: "ホワイト",
};

// 見た目の切り替え。端末の設定なので保存ボタンは無く、押した瞬間に変わる（記念日の「保存」と同じ列に
// 置かない）。選択肢は「ホーム上部の表示」と同じ部品・見た目。ゲストにも出す（ログイン不要。ADR-014）
function AppearanceCard() {
  const { appearance, setAppearance } = useAppearance();
  return (
    <Card>
      <View style={{ gap: space.md }}>
        <Text weight="bold">見た目</Text>
        {/* 相手には反映されないことを、聞かれる前に言う */}
        <Text size="xs" color="muted">
          この端末だけの設定です。相手には反映されません
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {APPEARANCE_VALUES.map((value) => (
            <Button
              key={value}
              variant={appearance === value ? "primary" : "secondary"}
              onPress={() => setAppearance(value)}
              testID={`profile-appearance-${value}`}
            >
              {APPEARANCE_LABELS[value]}
            </Button>
          ))}
        </View>
      </View>
    </Card>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { isGuestMode, exitGuestMode } = useGuestMode();
  // queryKey に viewerKey を含める（lib/viewer-key.ts。T9）。ゲスト中もフックは走るので両方に要る。
  // me.get は readProcedure を使わない唯一の例外だが、利用者ごとのデータ（名前・メール・画像）を返すので
  // 同じく対象（網羅テストは readProcedure を走査するので、この 1 本は映らない）
  const viewerKey = useViewerQueryKey();
  const meQuery = useQuery({
    ...orpc.me.get.queryOptions(),
    queryKey: [...orpc.me.get.queryOptions().queryKey, viewerKey],
  });
  const coupleQuery = useQuery({
    ...orpc.couple.get.queryOptions(),
    queryKey: [...orpc.couple.get.queryOptions().queryKey, viewerKey],
  });
  // 招待コードの再発行を「ペアが 1 人のときだけ」出すため、相手が参加済みかを stats.get の members で見る（025）
  const statsQuery = useQuery({
    ...orpc.stats.get.queryOptions(),
    queryKey: [...orpc.stats.get.queryOptions().queryKey, viewerKey],
  });

  const [name, setName] = useState("");
  // 選び直した画像は保存を押すまでアップロードしない（キャンセルすれば上がらない）
  const [pendingImage, setPendingImage] = useState<SourceImage | null>(null);
  // 付き合った日は NULL 許容（登録時に聞かない。023）。"" で未設定を表す
  const [datingDate, setDatingDate] = useState("");
  const [marriedDate, setMarriedDate] = useState("");
  const [primaryDate, setPrimaryDate] = useState<PrimaryDate>("dating");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  // 招待コードの再発行。この画面の中で完結するので PENDING_INVITE_QUERY_KEY は使わない（025）
  const [reissuedInvite, setReissuedInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [inviteErrorMessage, setInviteErrorMessage] = useState<string | null>(null);
  // 「アルバムの写真をまとめて保存」（すべての写真を ZIP で。048）のシート
  const [zipSource, setZipSource] = useState<ZipSource | null>(null);
  // 猶予・鍵の帯（047）
  const lockNoticeFor = lockNotice(coupleQuery.data?.planState, coupleQuery.data?.albumQuota ?? null);

  // サーバのデータは最初の 1 回だけフォームへ入れる（開いたままの画面なので、再取得で入力を上書きしない）
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    if (!meQuery.data || !coupleQuery.data) return;
    setName(meQuery.data.name);
    setDatingDate(coupleQuery.data.datingDate ?? "");
    setMarriedDate(coupleQuery.data.marriedDate ?? "");
    setPrimaryDate(coupleQuery.data.primaryDate);
    initializedRef.current = true;
  }, [meQuery.data, coupleQuery.data]);

  const requestUploadUrl = useMutation(orpc.me.uploadImageUrl.mutationOptions());
  const updateMe = useMutation(orpc.me.update.mutationOptions());
  const updateCouple = useMutation(orpc.couple.update.mutationOptions());
  const issueInvite = useMutation(orpc.invite.issue.mutationOptions());
  const setAiOptIn = useMutation(
    orpc.me.setAiOptIn.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.me.get.key() }),
    }),
  );
  // 天気の地域（058）。couple.get の weatherArea を読み直す
  const [weatherSheetOpen, setWeatherSheetOpen] = useState(false);
  const updateWeatherArea = useMutation(
    orpc.me.updateWeatherArea.mutationOptions({
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.couple.get.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.weather.get.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.weather.getForDate.key() }),
        ]),
    }),
  );
  // 「プランを管理 ›」→ Stripe の Billing Portal（解約・カード変更）。同じタブで移動する（048）
  const portal = useMutation(
    orpc.billing.createPortalSession.mutationOptions({
      onSuccess: ({ url }) => {
        if (Platform.OS === "web" && typeof window !== "undefined") window.location.assign(url);
      },
    }),
  );
  const isSubmitting = requestUploadUrl.isPending || updateMe.isPending || updateCouple.isPending;

  // 相手が参加済みか。stats が届くまでは判断できないので、カードを出さない（1 人と決めつけて発行の導線を出さない）
  const isPairComplete = (statsQuery.data?.members.length ?? 0) >= 2;
  const inviteExpiresAtLabel = reissuedInvite ? formatJstDateTime(reissuedInvite.expiresAt) : "";

  async function handleReissueInvite() {
    setInviteErrorMessage(null);
    try {
      const issued = await issueInvite.mutateAsync();
      setReissuedInvite(issued);
    } catch (error) {
      // ここにいるのは認証済み（ゲストは上で return）なので、FORBIDDEN は「満員」しかない。
      // 「もう一度お試しください」は成功しない操作を勧めるので、理由を案内して stats を読み直す。
      // catch の error（unknown）では isDefinedError が never に潰れるので instanceof で見る
      if (error instanceof ORPCError && error.code === "FORBIDDEN") {
        setInviteErrorMessage("相手が参加済みです");
        void statsQuery.refetch();
      } else {
        setInviteErrorMessage("発行できませんでした。もう一度お試しください");
      }
    }
  }

  async function handleShareInvite() {
    if (!reissuedInvite) return;
    await Share.share({
      message: `Nisoineでペアを作りました。招待コード: ${reissuedInvite.code}\nこのコードで参加してね（${inviteExpiresAtLabel} まで有効）`,
    });
  }

  const trimmedName = name.trim();
  const trimmedDatingDate = datingDate.trim();
  const datingDateValid = trimmedDatingDate.length === 0 || DATE_PATTERN.test(trimmedDatingDate);
  const trimmedMarriedDate = marriedDate.trim();
  const marriedDateValid = trimmedMarriedDate.length === 0 || DATE_PATTERN.test(trimmedMarriedDate);
  const marriedDateRequired = primaryDate === "married" && trimmedMarriedDate.length === 0;
  // 付き合った日が空でも保存できる（「あとから設定する」場所が日付前提だと矛盾する。023）
  const canSave =
    trimmedName.length > 0 &&
    trimmedName.length <= MAX_NAME_LENGTH &&
    datingDateValid &&
    marriedDateValid &&
    !marriedDateRequired;

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: false,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;
    setPendingImage({ uri: asset.uri, width: asset.width, height: asset.height, mimeType: asset.mimeType });
  }

  async function handleSave() {
    if (!canSave) return;
    setErrorMessage(null);
    setSavedMessage(null);

    try {
      let imageId: string | undefined;
      if (pendingImage) {
        const compressed = await compressImage(pendingImage);
        const uploaded = await uploadCompressedImage(
          (contentType) => requestUploadUrl.mutateAsync({ contentType }),
          compressed,
        );
        imageId = uploaded.imageId;
      }

      await updateMe.mutateAsync({ name: trimmedName, imageId });
      // 記念日はふたりの共有データ。相手にも影響することを保存後の文言で言う
      await updateCouple.mutateAsync({
        datingDate: trimmedDatingDate.length > 0 ? trimmedDatingDate : null,
        marriedDate: trimmedMarriedDate.length > 0 ? trimmedMarriedDate : null,
        primaryDate,
      });

      setPendingImage(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.me.get.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.couple.get.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.stats.get.key() }),
      ]);
      setSavedMessage("保存しました。記念日はふたりに共通する設定です");
    } catch {
      setErrorMessage("保存できませんでした。もう一度お試しください");
    }
  }

  const avatarImageUrl = pendingImage?.uri ?? meQuery.data?.image ?? undefined;

  // ゲストには「自分」が居ない（me.get は null）ので、編集フォームを出さずログインを促す。
  // 「見た目」はログイン不要の設定なので、その上に出す（039）。ScrollView にせず View のまま
  // （合成レイヤーが増えるとタブバーの影のにじみが変わる。カード + 案内は 568pt の画面にも収まる）
  if (isGuestMode) {
    return (
      <Screen>
        <View style={{ flex: 1, paddingBottom: TAB_BAR_CLEARANCE }}>
          <View style={{ padding: space.lg }}>
            <AppearanceCard />
          </View>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }}>
            <Text weight="bold">マイページはログインすると使えます</Text>
            <Text size="sm" color="muted" align="center">
              名前やアイコン、記念日を設定するには、Googleアカウントでログインしてください
            </Text>
            <Button onPress={exitGuestMode}>ログイン</Button>
            {/* ゲストにもプライバシーポリシー・利用規約は読める */}
            <LegalLinks />
          </View>
        </View>
      </Screen>
    );
  }

  // 読み込み中: 値が届く前に空欄のフォームを出さない
  if ((meQuery.isLoading || coupleQuery.isLoading) && (!meQuery.data || !coupleQuery.data)) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>
          <Text color="muted">読み込み中…</Text>
        </View>
      </Screen>
    );
  }

  // エラー: 空欄のまま止まって見えないよう、再試行ボタン付きで出す
  if ((meQuery.isError || coupleQuery.isError) && (!meQuery.data || !coupleQuery.data)) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }}>
          <Text color="muted">マイページを読み込めませんでした</Text>
          <Button
            onPress={async () => {
              await Promise.all([meQuery.refetch(), coupleQuery.refetch()]);
            }}
          >
            再試行
          </Button>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.lg }}>
          <View style={{ alignItems: "center", gap: space.md }}>
            <Pressable onPress={pickImage} accessibilityRole="button" accessibilityLabel="アイコン画像を変更">
              <Avatar name={name || "?"} imageUrl={avatarImageUrl} size={64} />
            </Pressable>
            <Button variant="ghost" onPress={pickImage}>
              アイコン画像を変更
            </Button>
          </View>

          <Card>
            <View style={{ gap: space.md }}>
              <Text weight="bold">プロフィール</Text>

              <View style={{ gap: space.xs }}>
                <Text size="sm" color="muted">
                  名前
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="名前"
                  placeholderTextColor={colors.textMuted}
                  maxLength={MAX_NAME_LENGTH}
                  testID="profile-name"
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.input,
                    padding: space.md,
                    fontSize: 16,
                    color: colors.text,
                  }}
                />
              </View>

              <Text size="sm" color="muted">
                {meQuery.data?.email}
              </Text>
            </View>
          </Card>

          {/* 記念日カードの上、プロフィールカードの下（039） */}
          <AppearanceCard />

          <Card>
            <View style={{ gap: space.md }}>
              <Text weight="bold">記念日</Text>
              <Text size="xs" color="muted">
                ふたりの共有データです。変更するともう1人にも反映されます
              </Text>

              <View style={{ gap: space.xs }}>
                <Text size="sm" color="muted">
                  付き合った日（任意）
                </Text>
                <DateInput8 value={datingDate} onChange={setDatingDate} testID="profile-dating-date" />
              </View>

              <View style={{ gap: space.xs }}>
                <Text size="sm" color="muted">
                  結婚した日（任意）
                </Text>
                <DateInput8 value={marriedDate} onChange={setMarriedDate} testID="profile-married-date" />
                {marriedDateRequired && (
                  <Text size="xs" color="muted">
                    「結婚した日」を表示するには、結婚した日を入力してください
                  </Text>
                )}
              </View>

              <View style={{ gap: space.xs }}>
                <Text size="sm" color="muted">
                  ホーム上部の表示
                </Text>
                {/* flex:1 で等分すると iPhone 幅で「付き合」「った日」のように単語の途中で折れる。
                    内容の幅で並べ、収まらない分だけ次の行へ折る */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {PRIMARY_DATE_VALUES.map((value) => (
                    <Button
                      key={value}
                      variant={primaryDate === value ? "primary" : "secondary"}
                      onPress={() => setPrimaryDate(value)}
                      testID={`profile-primary-date-${value}`}
                    >
                      {PRIMARY_DATE_LABELS[value]}
                    </Button>
                  ))}
                </View>
              </View>
            </View>
          </Card>

          {/* 招待コードの再発行。ペアが 1 人のときだけ出す（揃っていたら出さず理由を書く。押せないボタンを
              置かない）。満員ならサーバも拒むので、これは見せ方だけ（security-requirements.md T5）。
              stats が届くまではカードを出さない（025） */}
          {statsQuery.data && (
          <Card>
            <View style={{ gap: space.md }}>
              <Text weight="bold">招待コード</Text>
              {isPairComplete ? (
                <Text size="sm" color="muted">
                  相手が参加済みです
                </Text>
              ) : (
                <>
                  {/* 押す前に伝える（押したあとに気づく形にしない） */}
                  <Text size="xs" color="muted">
                    発行すると、以前発行した招待コードは無効になります。相手に渡し済みの場合は注意してください
                  </Text>
                  {reissuedInvite && (
                    <>
                      <Card>
                        <Text size="xl" weight="bold" color="brand">
                          {reissuedInvite.code}
                        </Text>
                      </Card>
                      <Text size="sm" color="muted">
                        {inviteExpiresAtLabel} まで有効です
                      </Text>
                      <Button variant="secondary" onPress={handleShareInvite}>
                        コードを共有する
                      </Button>
                    </>
                  )}
                  {inviteErrorMessage && (
                    <Text size="sm" color="muted">
                      {inviteErrorMessage}
                    </Text>
                  )}
                  <Button onPress={handleReissueInvite} disabled={issueInvite.isPending} testID="profile-reissue-invite">
                    {issueInvite.isPending ? "発行中…" : reissuedInvite ? "コードを再発行する" : "招待コードを発行する"}
                  </Button>
                </>
              )}
            </View>
          </Card>
          )}

          {errorMessage && (
            <Text size="sm" color="muted">
              {errorMessage}
            </Text>
          )}
          {savedMessage && (
            <Text size="sm" color="brand">
              {savedMessage}
            </Text>
          )}

          <Button onPress={handleSave} disabled={!canSave} testID="profile-save">
            {isSubmitting ? "保存中…" : "保存する"}
          </Button>

          {/* 天気の地域（個人ごと。位置情報は取らない）。押すと都道府県 → 予報区のシート（058） */}
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
              <View style={{ gap: 2 }}>
                <Text weight="bold">天気の地域</Text>
                <Text size="xs" color="muted">
                  カレンダーに 7 日先までの天気を出します
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="天気の地域を選ぶ"
                onPress={() => setWeatherSheetOpen(true)}
                disabled={updateWeatherArea.isPending}
                hitSlop={space.sm}
                testID="profile-weather-area"
              >
                <Text size="sm" weight="medium" color="brand">
                  {`${coupleQuery.data?.weatherArea?.name ?? "未設定"} ›`}
                </Text>
              </Pressable>
            </View>
          </Card>

          {/* 同意は設定であって機能の一部ではないので、AI まとめの画面に埋めずここに置く（037） */}
          <Card>
            <View style={{ gap: space.sm }}>
              <Text weight="bold">AIまとめ</Text>
              <Text size="xs" color="muted">
                投稿の本文が外部の生成AI（OpenAIまたはAnthropic）に送られます。
                2人とも同意したときだけ使えます
              </Text>
              <Button
                variant={meQuery.data?.aiOptIn ? "secondary" : "primary"}
                onPress={() => setAiOptIn.mutate({ optIn: !meQuery.data?.aiOptIn })}
                disabled={setAiOptIn.isPending}
              >
                {meQuery.data?.aiOptIn ? "同意を取り消す" : "同意する"}
              </Button>
              <Text size="xs" color="muted">
                相手: {meQuery.data?.partnerAiOptIn ? "同意済み" : "未同意"}
              </Text>
            </View>
          </Card>

          {/* プレミアムをやめたあとの猶予・鍵の帯（プランの行の上。047） */}
          {lockNoticeFor && (
            <LockBand notice={lockNoticeFor} onZip={() => setZipSource({ kind: "all" })} onPremium={() => router.push("/premium")} />
          )}

          {/* 「プラン: 無料／プレミアム」の 1 行。無料なら右に「プレミアムについて ›」。paid は
              「プレミアム（9月15日に更新）」（無期限なら日付無し）で、stripe の行なら右に「プランを管理 ›」。
              manual は表示だけ。「お試し」は使わない（045・048） */}
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
              <Text weight="bold">
                プラン:{" "}
                <Text weight="bold" testID="profile-plan">
                  {coupleQuery.data
                    ? coupleQuery.data.plan === "paid"
                      ? paidPlanLabel(coupleQuery.data.planExpiresAt, coupleQuery.data.planCancelAt)
                      : planLabel(coupleQuery.data.plan)
                    : ""}
                </Text>
              </Text>
              {coupleQuery.data?.plan === "paid" && coupleQuery.data.planSource === "stripe" && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="プランを管理"
                  onPress={() => portal.mutate({})}
                  disabled={portal.isPending}
                  hitSlop={space.sm}
                  testID="profile-manage-plan"
                >
                  <Text size="sm" weight="medium" color="brand">
                    プランを管理 ›
                  </Text>
                </Pressable>
              )}
              {coupleQuery.data?.plan === "free" && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="プレミアムについて"
                  onPress={() => router.push("/premium")}
                  hitSlop={space.sm}
                  testID="profile-premium"
                >
                  <Text size="sm" weight="medium" color="brand">
                    プレミアムについて ›
                  </Text>
                </Pressable>
              )}
            </View>
            {/* 「アルバムの写真をまとめて保存」（一覧の ⋯ と同じ。猶予の案内から飛ぶ先。048） */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="アルバムの写真をまとめて保存"
              onPress={() => setZipSource({ kind: "all" })}
              hitSlop={space.sm}
              testID="profile-zip"
              style={{ marginTop: space.md }}
            >
              <Text size="sm" weight="medium" color="brand">
                アルバムの写真をまとめて保存 ›
              </Text>
            </Pressable>
          </Card>

          <Button
            variant="secondary"
            onPress={async () => {
              await signOut();
            }}
          >
            ログアウト
          </Button>

          {/* ここは入口の 1 行。消えるのがふたりのデータであることは delete-account.tsx の 2 段階の確認で言う */}
          <Button variant="ghost" onPress={() => router.push("/delete-account")}>
            アカウントを削除
          </Button>

          {/* 運営のときだけ「運営 ›」。他の人には入口が見えない（057） */}
          {coupleQuery.data?.isAdmin && (
            <Pressable accessibilityRole="button" accessibilityLabel="運営" onPress={() => router.push("/admin")} hitSlop={space.sm} testID="profile-admin">
              <Text size="sm" weight="medium" color="brand" align="center">
                運営 ›
              </Text>
            </Pressable>
          )}

          {/* 一番下にプライバシーポリシー・利用規約（052） */}
          <LegalLinks />
      </ScrollView>

      <ZipExportSheet source={zipSource} onClose={() => setZipSource(null)} />
      <WeatherAreaSheet
        visible={weatherSheetOpen}
        current={coupleQuery.data?.weatherArea?.code ?? null}
        onClose={() => setWeatherSheetOpen(false)}
        onSelect={(areaCode) => {
          setWeatherSheetOpen(false);
          updateWeatherArea.mutate({ areaCode });
        }}
      />
    </Screen>
  );
}

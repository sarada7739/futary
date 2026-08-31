import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Share, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { formatJstDateTime } from "@futary/date";
import { PRIMARY_DATE_VALUES, type Couple } from "@futary/contract";
import { Avatar, Button, Card, colors, radius, Screen, space, Text } from "@futary/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DateInput8 } from "../../components/date-input8";
import { compressImage, uploadCompressedImage, type SourceImage } from "../../lib/image";
import { useGuestMode } from "../../lib/guest-mode";
import { orpc } from "../../lib/orpc";
import { queryClient } from "../../lib/query";
import { signOut } from "../../lib/auth-client";
import { useViewerQueryKey } from "../../lib/viewer-key";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME_LENGTH = 20;

type PrimaryDate = Couple["primaryDate"];

// ホーム上部に何を表示するか（019）。ラベルはこの画面だけで使うため
// event-kind.tsのような共有libには出さない
const PRIMARY_DATE_LABELS: Record<PrimaryDate, string> = {
  dating: "付き合った日",
  married: "結婚した日",
  none: "非表示",
};

export default function ProfileScreen() {
  const { isGuestMode, exitGuestMode } = useGuestMode();
  // queryKeyにviewerKeyを含める理由はapps/app/lib/viewer-key.ts参照（T9）。
  // この画面はguestMode中もフックだけは実行される（早期returnより後で
  // couple.get/me.getを使うため）ため、両方に同じ対策が要る。
  // me.getはreadProcedureを使わない（005の認可基底の唯一の例外。
  // apps/api/src/router.ts）が、名前・メールアドレス・アイコン画像という
  // 利用者ごとのデータを返すため、couple.get等5つと同じ理由でT9の対象
  // （Rレビュー指摘: 走査ロジックがreadProcedureだけを見るため、この1本は
  // 網羅テストに構造的に映らない。抜けたまま気づけなかった）
  const viewerKey = useViewerQueryKey();
  const meQuery = useQuery({
    ...orpc.me.get.queryOptions(),
    queryKey: [...orpc.me.get.queryOptions().queryKey, viewerKey],
  });
  const coupleQuery = useQuery({
    ...orpc.couple.get.queryOptions(),
    queryKey: [...orpc.couple.get.queryOptions().queryKey, viewerKey],
  });
  // 025: 招待コードの再発行導線を「ペアが1人のときだけ」出すため、
  // 相手が参加済みかをstats.getのmembersで見る（他の問い合わせと同じくT9対応）
  const statsQuery = useQuery({
    ...orpc.stats.get.queryOptions(),
    queryKey: [...orpc.stats.get.queryOptions().queryKey, viewerKey],
  });

  const [name, setName] = useState("");
  // 選び直した画像はここに置き、保存を押すまでアップロードしない
  // （compose.tsxと同じ形。キャンセルすればアップロードされずに済む）
  const [pendingImage, setPendingImage] = useState<SourceImage | null>(null);
  // 023: 付き合った日はNULL許容になった（登録時に聞かなくなったため）。
  // marriedDateと同じく""で「未設定」を表す
  const [datingDate, setDatingDate] = useState("");
  const [marriedDate, setMarriedDate] = useState("");
  const [primaryDate, setPrimaryDate] = useState<PrimaryDate>("dating");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  // 025: 招待コードの再発行。この画面の中だけで完結する（onboardingのcreate→invite
  // のように別画面へ渡す必要が無いため、PENDING_INVITE_QUERY_KEYは使わない）
  const [reissuedInvite, setReissuedInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [inviteErrorMessage, setInviteErrorMessage] = useState<string | null>(null);

  // サーバのデータが届いた最初の1回だけフォームへ反映する。以降は
  // 利用者の入力をサーバ再取得で上書きしない（event-form.tsxのvisible再初期化とは
  // 違い、この画面は開いたままなので「初回のみ」で揃える）
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
  const isSubmitting = requestUploadUrl.isPending || updateMe.isPending || updateCouple.isPending;

  // 相手が参加済み（2人揃っている）かどうか。statsQuery.dataが届くまでは
  // まだ判断できないため、招待コードのカード自体を出さない（読み込み中に
  // 「1人だけ」と誤って決めつけて発行導線を出してしまうことを防ぐ）
  const isPairComplete = (statsQuery.data?.members.length ?? 0) >= 2;
  const inviteExpiresAtLabel = reissuedInvite ? formatJstDateTime(reissuedInvite.expiresAt) : "";

  async function handleReissueInvite() {
    setInviteErrorMessage(null);
    try {
      const issued = await issueInvite.mutateAsync();
      setReissuedInvite(issued);
    } catch {
      setInviteErrorMessage("発行できませんでした。もう一度お試しください");
    }
  }

  async function handleShareInvite() {
    if (!reissuedInvite) return;
    await Share.share({
      message: `futaryでペアを作りました。招待コード: ${reissuedInvite.code}\nこのコードで参加してね（${inviteExpiresAtLabel} まで有効）`,
    });
  }

  const trimmedName = name.trim();
  const trimmedDatingDate = datingDate.trim();
  const datingDateValid = trimmedDatingDate.length === 0 || DATE_PATTERN.test(trimmedDatingDate);
  const trimmedMarriedDate = marriedDate.trim();
  const marriedDateValid = trimmedMarriedDate.length === 0 || DATE_PATTERN.test(trimmedMarriedDate);
  const marriedDateRequired = primaryDate === "married" && trimmedMarriedDate.length === 0;
  // 023: datingDateが空でも保存できる（「マイページであとから設定する」が
  // このタスクの目的なのに、そのマイページが日付前提だと矛盾する）
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
      // 記念日はふたりの共有データ。変更した本人以外にも影響することが
      // 分かるよう、保存後の文言で明示する（019タスク定義）
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

  // 014: デモ閲覧中は「自分」が存在しない（未認証。me.getはnullを返す）ため、
  // プロフィール編集フォームを出さずログインを促す
  if (isGuestMode) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }}>
          <Text weight="bold">マイページはログインすると使えます</Text>
          <Text size="sm" color="muted" align="center">
            名前やアイコン、記念日を設定するには、Googleアカウントでログインしてください
          </Text>
          <Button onPress={exitGuestMode}>ログイン</Button>
        </View>
      </Screen>
    );
  }

  // 読み込み中: サーバの値が届く前にフォームを空欄のまま表示しない
  // （calendar.tsxと同じ「データが無い間はローディング表示」の方針）
  if ((meQuery.isLoading || coupleQuery.isLoading) && (!meQuery.data || !coupleQuery.data)) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>
          <Text color="muted">読み込み中…</Text>
        </View>
      </Screen>
    );
  }

  // エラー: 何も表示せず永久にフォームが空欄のまま止まって見えることを防ぐ
  // （calendar.tsxと同じ「再試行ボタン付きのエラー表示」の方針）
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
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
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
                {/* flex:1で等分すると、iPhone幅ではボタンの中で文字が
                    「付き合」「った日」のように単語の途中で折り返されて
                    見苦しくなる（人間の実機確認で発覚）。ボタンを内容の幅で
                    並べ、収まらない分だけ次の行へ折り返す形にした */}
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

          {/* 025: 招待コードの再発行。ペアが1人のときだけ出す（2人揃っていたら
              出さず、理由を書く。020「押せないボタンを置かない」の方針）。
              満員のペアではサーバ側（invite.issue）も拒むため、これは
              UI側の見せ方に過ぎない（security-requirements.md T5と同じ考え方）。
              statsQuery.dataが届くまではメンバー数を判断できないため、
              カード自体を出さない */}
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
                  {/* 押す前に伝える（押したあとに気づく形にしない。025タスク定義） */}
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

          <Button
            variant="secondary"
            onPress={async () => {
              await signOut();
            }}
          >
            ログアウト
          </Button>
      </ScrollView>
    </Screen>
  );
}

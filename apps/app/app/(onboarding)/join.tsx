import { isDefinedError } from "@orpc/client";
import { Button, Screen, Text, colors, radius, space } from "@futary/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { orpc } from "../../lib/orpc";

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: "コードが正しくないか、期限切れ・使用済みです",
  RATE_LIMITED: "試行回数が多すぎます。しばらくしてからお試しください",
  FORBIDDEN: "参加できませんでした",
};

export default function JoinCoupleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");

  const acceptInvite = useMutation(orpc.invite.accept.mutationOptions());

  // 【不具合修正】以前はここで`queryClient.setQueryData(orpc.couple.get.queryKey(), couple)`
  // としていたが、viewerKeyを含まないキーへの書き込みだった。_layout.tsxの
  // coupleQueryは`[...orpc.couple.get.queryOptions().queryKey, viewerKey]`
  // というキーで読んでいる（T9。apps/app/lib/viewer-key.ts）ため、この
  // setQueryDataは実際には別のキャッシュ枠に書き込むだけで、ルートの
  // ガード（hasCouple/needsOnboarding）が見ているデータには一切反映
  // されず、router.replace("/")してもcouple.get未所属のまま
  // (onboarding)へ差し戻されていた（＝コード入力後、再びコードで参加する
  // 画面に戻る）。invite.tsxのhandleContinueと同じ、invalidateQueries
  // （queryKeyの前方一致でviewerKey付きの実キーも対象になる）に揃える
  async function handleSubmit() {
    await acceptInvite.mutateAsync({ code });
    await queryClient.invalidateQueries({ queryKey: orpc.couple.get.key() });
    router.replace("/");
  }

  const errorMessage = isDefinedError(acceptInvite.error)
    ? (ERROR_MESSAGES[acceptInvite.error.code] ?? "うまくいきませんでした")
    : acceptInvite.isError
      ? "うまくいきませんでした"
      : null;

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", padding: space.xxl, gap: space.lg }}>
        <Text size="lg" weight="bold">
          招待コードを入力してください
        </Text>
        <TextInput
          value={code}
          onChangeText={(value) => setCode(value.toUpperCase())}
          placeholder="6桁のコード"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          maxLength={6}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.input,
            padding: space.md,
            fontSize: 24,
            letterSpacing: 4,
            textAlign: "center",
            color: colors.text,
          }}
        />
        {errorMessage && <Text color="muted">{errorMessage}</Text>}
        <Button onPress={handleSubmit} disabled={code.length !== 6 || acceptInvite.isPending}>
          {acceptInvite.isPending ? "確認中…" : "参加する"}
        </Button>
      </View>
    </Screen>
  );
}

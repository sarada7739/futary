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

  async function handleSubmit() {
    const couple = await acceptInvite.mutateAsync({ code });
    queryClient.setQueryData(orpc.couple.get.queryKey(), couple);
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

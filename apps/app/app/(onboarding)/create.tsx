import { Button, Screen, Text, colors, radius, space } from "@futary/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { orpc } from "../../lib/orpc";
import { PENDING_INVITE_QUERY_KEY } from "./invite";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function CreateCoupleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [anniversaryDate, setAnniversaryDate] = useState("");

  const createCouple = useMutation(orpc.couple.create.mutationOptions());
  const issueInvite = useMutation(orpc.invite.issue.mutationOptions());

  const isValidDate = DATE_PATTERN.test(anniversaryDate);
  const isSubmitting = createCouple.isPending || issueInvite.isPending;

  async function handleSubmit() {
    if (!isValidDate) return;
    await createCouple.mutateAsync({ anniversaryDate });
    // ペア作成直後に一度だけ、明示的なこの操作の一部として発行する。
    // 招待コードは機密度が高くURLに乗せられないため（security-auditor 004監査
    // Medium指摘）ルーティングパラメータではなくクエリキャッシュ経由で invite.tsx
    // に渡す。invite.tsx 側は画面表示のたびには発行しない（後述の副作用対策）
    const invite = await issueInvite.mutateAsync();
    queryClient.setQueryData(PENDING_INVITE_QUERY_KEY, invite);
    router.push("/invite");
  }

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", padding: space.xxl, gap: space.lg }}>
        <Text size="lg" weight="bold">
          付き合った日を教えてください
        </Text>
        <TextInput
          value={anniversaryDate}
          onChangeText={setAnniversaryDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textMuted}
          keyboardType="numbers-and-punctuation"
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.input,
            padding: space.md,
            fontSize: 16,
            color: colors.text,
          }}
        />
        {(createCouple.isError || issueInvite.isError) && (
          <Text color="muted">うまくいきませんでした。もう一度お試しください</Text>
        )}
        <Button onPress={handleSubmit} disabled={!isValidDate || isSubmitting}>
          {isSubmitting ? "作成中…" : "作成する"}
        </Button>
      </View>
    </Screen>
  );
}

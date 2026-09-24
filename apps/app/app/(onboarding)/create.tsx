import { Button, Screen, Text, space } from "@futary/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { orpc } from "../../lib/orpc";
import { useViewerQueryKey } from "../../lib/viewer-key";
import { pendingInviteQueryKey } from "./invite";

// 付き合った日は登録時に聞かない（結婚している人は覚えていないことがある）。マイページであとから設定する（023）
export default function CreateCoupleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const viewerKey = useViewerQueryKey();

  const createCouple = useMutation(orpc.couple.create.mutationOptions());
  const issueInvite = useMutation(orpc.invite.issue.mutationOptions());

  const isSubmitting = createCouple.isPending || issueInvite.isPending;

  async function handleSubmit() {
    await createCouple.mutateAsync({});
    // ペアを作った直後に一度だけ、この明示的な操作の一部として発行する。招待コードは URL に乗せられないので、
    // ルートのパラメータでなくクエリのキャッシュで invite.tsx に渡す（invite.tsx は表示のたびには発行しない）
    const invite = await issueInvite.mutateAsync();
    queryClient.setQueryData(pendingInviteQueryKey(viewerKey), invite);
    router.push("/invite");
  }

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", padding: space.xxl, gap: space.lg }}>
        <Text size="lg" weight="bold">
          ふたりのペアを作りましょう
        </Text>
        {(createCouple.isError || issueInvite.isError) && (
          <Text color="muted">うまくいきませんでした。もう一度お試しください</Text>
        )}
        <Button onPress={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "作成中…" : "作成する"}
        </Button>
      </View>
    </Screen>
  );
}

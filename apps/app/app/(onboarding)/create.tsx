import { Button, Screen, Text, space } from "@futary/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { orpc } from "../../lib/orpc";
import { useViewerQueryKey } from "../../lib/viewer-key";
import { pendingInviteQueryKey } from "./invite";

// 023: 付き合った日は登録時に聞かない（すでに結婚している人は覚えていない
// 場合がある）。ペアを作る操作だけが残る。付き合った日はマイページで
// あとから設定する（019で既に設定できる）
export default function CreateCoupleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const viewerKey = useViewerQueryKey();

  const createCouple = useMutation(orpc.couple.create.mutationOptions());
  const issueInvite = useMutation(orpc.invite.issue.mutationOptions());

  const isSubmitting = createCouple.isPending || issueInvite.isPending;

  async function handleSubmit() {
    await createCouple.mutateAsync({});
    // ペア作成直後に一度だけ、明示的なこの操作の一部として発行する。
    // 招待コードは機密度が高くURLに乗せられないため（security-auditor 004監査
    // Medium指摘）ルーティングパラメータではなくクエリキャッシュ経由で invite.tsx
    // に渡す。invite.tsx 側は画面表示のたびには発行しない（後述の副作用対策）
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

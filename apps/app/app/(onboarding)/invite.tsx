import { formatJstDateTime } from "@futary/date";
import { Button, Card, Screen, Text, space } from "@futary/ui";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Share, View } from "react-native";
import { orpc } from "../../lib/orpc";
import { useViewerQueryKey } from "../../lib/viewer-key";

type IssuedInvite = { code: string; expiresAt: number };

// create.tsx がペア作成直後に発行したコードを渡すキャッシュのキー（ルートのパラメータに乗せない理由は下）。
// 手続きの戻り値ではないが、中身は招待コード（ペアに入る鍵）なので viewerKey を含める
// （viewer-key-coverage.test.ts の MANUALLY_PLACED_CACHE_KEYS が強制する。T9）
export function pendingInviteQueryKey(viewerKey: string): QueryKey {
  return ["onboarding", "pendingInvite", viewerKey];
}

export default function InviteCodeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const viewerKey = useViewerQueryKey();
  // create.tsx から渡された、作成直後に発行済みのコード（無ければ null）
  const [invite, setInvite] = useState<IssuedInvite | null>(
    () => queryClient.getQueryData<IssuedInvite>(pendingInviteQueryKey(viewerKey)) ?? null,
  );

  const issueInvite = useMutation(orpc.invite.issue.mutationOptions());

  // 画面を開いただけで自動発行しない。invite.issue は再発行のたびに前のコードを無効にするので、相手に渡した
  // 有効なコードが消える（SameSite=Lax ではトップレベル遷移に Cookie が乗り、URL を踏ませるだけで妨害できる）。
  // 発行は必ずこのボタンの操作から
  async function handleIssue() {
    const issued = await issueInvite.mutateAsync();
    queryClient.setQueryData(pendingInviteQueryKey(viewerKey), issued);
    setInvite(issued);
  }

  const expiresAtLabel = invite ? formatJstDateTime(invite.expiresAt) : "";

  async function handleShare() {
    if (!invite) return;
    await Share.share({
      message: `Nisoineでペアを作りました。招待コード: ${invite.code}\nこのコードで参加してね（${expiresAtLabel} まで有効）`,
    });
  }

  function handleContinue() {
    // couple.get を読み直させ、ルートの判定で (tabs) へ切り替える
    queryClient.removeQueries({ queryKey: pendingInviteQueryKey(viewerKey) });
    void queryClient.invalidateQueries({ queryKey: orpc.couple.get.key() });
    router.replace("/");
  }

  return (
    <Screen>
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: space.xxl,
          gap: space.xl,
        }}
      >
        <Text size="lg" weight="bold">
          招待コード
        </Text>
        {issueInvite.isError && <Text color="muted">発行に失敗しました</Text>}
        {invite ? (
          <>
            <Card>
              <Text size="xl" weight="bold" color="brand">
                {invite.code}
              </Text>
            </Card>
            <Text color="muted">{expiresAtLabel} まで有効です</Text>
          </>
        ) : (
          <Text color="muted">まだコードがありません</Text>
        )}
        <View style={{ width: "100%", gap: space.md }}>
          {invite ? (
            <Button onPress={handleShare}>コードを共有する</Button>
          ) : (
            <Button onPress={handleIssue} disabled={issueInvite.isPending}>
              {issueInvite.isPending ? "発行中…" : "招待コードを発行する"}
            </Button>
          )}
          <Button variant="secondary" onPress={handleContinue}>
            はじめる
          </Button>
        </View>
      </View>
    </Screen>
  );
}

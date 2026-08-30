import { formatJstDateTime } from "@futary/date";
import { Button, Card, Screen, Text, space } from "@futary/ui";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Share, View } from "react-native";
import { orpc } from "../../lib/orpc";

type IssuedInvite = { code: string; expiresAt: number };

// create.tsx がペア作成直後に発行したコードを渡すためのキャッシュキー。
// ルーティングパラメータに乗せない理由は下記コメント参照
export const PENDING_INVITE_QUERY_KEY: QueryKey = ["onboarding", "pendingInvite"];

export default function InviteCodeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // create.tsx から渡された、作成直後に発行済みのコード（無ければ null）
  const [invite, setInvite] = useState<IssuedInvite | null>(
    () => queryClient.getQueryData<IssuedInvite>(PENDING_INVITE_QUERY_KEY) ?? null,
  );

  const issueInvite = useMutation(orpc.invite.issue.mutationOptions());

  // 画面表示（マウント・リロード・外部リンクからの遷移）だけで自動発行すると、
  // 既に相手に渡した有効なコードを無条件で無効化してしまう
  // （invite.issue は再発行のたびに前のコードを無効化する仕様のため）。
  // SameSite=Lax ではトップレベル遷移にCookieが乗るため、この画面のURLを
  // 踏ませるだけでペアリングを妨害できてしまう。発行は必ずユーザーの
  // 明示的な操作（このボタン）からのみ起こす
  // （security-auditor 004監査 Medium指摘。1回目の対応で自動発行にしたところ
  // この副作用が新たに生まれたため、2回目の指摘を受けて修正）
  async function handleIssue() {
    const issued = await issueInvite.mutateAsync();
    queryClient.setQueryData(PENDING_INVITE_QUERY_KEY, issued);
    setInvite(issued);
  }

  const expiresAtLabel = invite ? formatJstDateTime(invite.expiresAt) : "";

  async function handleShare() {
    if (!invite) return;
    await Share.share({
      message: `futaryでペアを作りました。招待コード: ${invite.code}\nこのコードで参加してね（${expiresAtLabel} まで有効）`,
    });
  }

  function handleContinue() {
    // couple.get を再取得させ、ルート側の判定で (tabs) へ切り替わるようにする
    queryClient.removeQueries({ queryKey: PENDING_INVITE_QUERY_KEY });
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

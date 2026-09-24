import { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { Button, Card, radius, Screen, space, Text, useTheme } from "@futary/ui";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { orpc } from "../../lib/orpc";
import { signIn, signOut } from "../../lib/auth-client";
import { queryClient } from "../../lib/query";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

// sign-in.tsx の resolveCallbackURL と同じ理由（ローカルのポート違い・アプリ本体は /app/*）。戻り先だけこの画面
function resolveReauthCallbackURL(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return `${window.location.origin}/app/delete-account`;
  return "/delete-account";
}

// アカウント削除と退会（024）。消えるのは相手の分も含めた全部なので、確認を 2 段階に分ける:
//   1 段階目: 何が消えるかを並べる
//   2 段階目: 相手のデータも消えること・相手に事前に知らせないことを書き、ここで初めて「削除する」が押せる
// 既定で押せる状態にしない（チェックを入れないと最終ボタンが押せない）
export default function DeleteAccountScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [stage, setStage] = useState<1 | 2>(1);
  const [acknowledged, setAcknowledged] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // サーバが REAUTH_REQUIRED で拒んだときに立てる。普段は sessionIsFresh で先に弾くので、ここに来るのは
  // 確認の途中で 5 分を跨いだときだけ（止めているのはサーバ。T5）
  const [serverRejectedReauth, setServerRejectedReauth] = useState(false);
  const isSigningInRef = useRef(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const deleteMe = useMutation(orpc.me.delete.mutationOptions());
  // queryKey に viewerKey を含める（profile.tsx と同じ。T9）
  const viewerKey = useViewerQueryKey();
  const meQuery = useQuery({
    ...orpc.me.get.queryOptions(),
    queryKey: [...orpc.me.get.queryOptions().queryKey, viewerKey],
  });

  // 確認画面に入れるかはサーバが真偽値で返す（sessionIsFresh）。ここで時刻を比べない
  const needsReauth = serverRejectedReauth || meQuery.data?.sessionIsFresh === false;

  function handleReauth() {
    if (isSigningInRef.current) return;
    isSigningInRef.current = true;
    setIsSigningIn(true);
    // signIn.social の Promise は redirect の開始直後に resolve するので、成功時は遷移まで戻さない
    void signIn.social({ provider: "google", callbackURL: resolveReauthCallbackURL() }).then((result) => {
      if (result?.error) {
        isSigningInRef.current = false;
        setIsSigningIn(false);
      }
    });
  }

  async function handleDelete() {
    if (!acknowledged) return;
    setErrorMessage(null);
    try {
      await deleteMe.mutateAsync();
    } catch (error) {
      if (error instanceof ORPCError && error.code === "REAUTH_REQUIRED") {
        setServerRejectedReauth(true);
        return;
      }
      setErrorMessage("削除できませんでした。もう一度お試しください");
      return;
    }

    // 削除の成否と signOut() の成否を分ける（同じ try だと、消えたのに「削除できませんでした」と出る）。
    // セッションはサーバで消えているが画面は知らないので、signOut() で切り替える（guard がサインイン画面へ
    // 導くので navigate は要らない）。削除は「消す」操作なので、viewerKey の隔離に加えてキャッシュも破棄する
    queryClient.clear();
    await signOut();
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: space.lg }}>
        <Text size="lg" weight="bold">
          ふたりのデータを削除
        </Text>

        {meQuery.isPending ? (
          // 読み込み中は sessionIsFresh が分からず、入れるかを判定できない
          <Text color="muted">読み込み中…</Text>
        ) : needsReauth ? (
          <>
            <Card>
              <View style={{ gap: space.sm }}>
                <Text weight="bold">もう一度ログインしてください</Text>
                <Text size="sm" color="muted">
                  不可逆で相手のデータまで消す操作のため、直近のログインを
                  確認できたときだけ削除に進めます。
                </Text>
              </View>
            </Card>
            <View style={{ gap: space.sm }}>
              <Button onPress={handleReauth} disabled={isSigningIn} testID="delete-account-reauth">
                もう一度ログインする
              </Button>
              <Button variant="ghost" onPress={() => router.back()} disabled={isSigningIn}>
                やめる
              </Button>
            </View>
          </>
        ) : stage === 1 ? (
          <>
            <Card>
              <View style={{ gap: space.sm }}>
                <Text weight="bold">削除すると、次が消えます</Text>
                <Text size="sm" color="muted">
                  ・投稿と写真{"\n"}
                  ・カレンダー（予定・記念日・会った日の記録）{"\n"}
                  ・統計（付き合った日数・投稿数など）{"\n"}
                  ・招待コード
                </Text>
              </View>
            </Card>
            <Text size="xs" color="muted">
              取り消せません。
            </Text>
            <Button onPress={() => setStage(2)}>次へ</Button>
          </>
        ) : (
          <>
            <Card>
              <View style={{ gap: space.sm }}>
                <Text weight="bold">相手のデータも消えます</Text>
                <Text size="sm" color="muted">
                  ・相手が書いた投稿も消えます{"\n"}
                  ・相手が押したリアクションも消えます{"\n"}
                  ・相手のプロフィール画像も消えます{"\n\n"}
                  相手には事前に知らせません。次に開いたとき、ペアが
                  無くなっていることで知ることになります。
                </Text>
              </View>
            </Card>

            <Pressable
              onPress={() => setAcknowledged((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acknowledged }}
              testID="delete-account-acknowledge"
              style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: radius.input,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: acknowledged ? colors.primary : "transparent",
                }}
              >
                {acknowledged && <Text color="brand">✓</Text>}
              </View>
              <Text size="sm">相手のデータも消えることを理解しました</Text>
            </Pressable>

            {errorMessage && (
              <Text size="sm" color="muted">
                {errorMessage}
              </Text>
            )}

            <View style={{ gap: space.sm }}>
              {/* 取り返しのつかない操作なので danger（塗りつぶしにしない = 押しやすくしない。architecture.md 7節） */}
              <Button
                variant="danger"
                onPress={handleDelete}
                disabled={!acknowledged || deleteMe.isPending}
                testID="delete-account-confirm"
              >
                {deleteMe.isPending ? "削除中…" : "ふたりのデータを削除する"}
              </Button>
              <Button variant="ghost" onPress={() => router.back()}>
                やめる
              </Button>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

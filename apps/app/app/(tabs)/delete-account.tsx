import { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { Button, Card, colors, radius, Screen, space, Text } from "@futary/ui";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { orpc } from "../../lib/orpc";
import { signIn, signOut } from "../../lib/auth-client";
import { queryClient } from "../../lib/query";
import { TAB_BAR_CLEARANCE } from "../../lib/tab-bar-layout";
import { useViewerQueryKey } from "../../lib/viewer-key";

// sign-in.tsxのresolveCallbackURLと同じ理由（ローカル開発でのポート違い・
// 015でアプリ本体が/app/*に分かれたこと）。戻り先だけこの画面にする
function resolveReauthCallbackURL(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return `${window.location.origin}/app/delete-account`;
  return "/delete-account";
}

// 024: アカウント削除と退会。
//
// 「あなたのアカウントを削除します」では足りない。消えるのは相手の分も
// 含めた全部である（Candle型。docs/tasks/024-account-deletion.md）。
// 確認を2段階に分ける:
//   1段階目: 何が消えるかを列挙する
//   2段階目: 相手のデータも消えること・相手に事前に知らせないことを明記する。
//            ここで初めて「削除する」が押せる
//
// 既定で押せる状態にしない（020「押しても何も起きない、にしない」の逆で、
// ここは押しにくくする）。チェックを入れないと最終ボタンが押せない形にした
export default function DeleteAccountScreen() {
  const router = useRouter();
  const [stage, setStage] = useState<1 | 2>(1);
  const [acknowledged, setAcknowledged] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // サーバがREAUTH_REQUIREDで拒んだとき（下のhandleDelete参照）に立てる。
  // 通常はmeQuery.data.sessionIsFreshで先に弾くため、ここに来るのは
  // 確認をやり切る間に5分を跨いだときだけ（Aの決定。T5: 止めているのは
  // サーバである）
  const [serverRejectedReauth, setServerRejectedReauth] = useState(false);
  const isSigningInRef = useRef(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const deleteMe = useMutation(orpc.me.delete.mutationOptions());
  // queryKeyにviewerKeyを含める理由はprofile.tsxと同じ（T9）
  const viewerKey = useViewerQueryKey();
  const meQuery = useQuery({
    ...orpc.me.get.queryOptions(),
    queryKey: [...orpc.me.get.queryOptions().queryKey, viewerKey],
  });

  // 024・Aの決定: 「削除確認画面に入れるか」はサーバが真偽値で返す
  // （sessionIsFresh）。判定はここでだけ行い、時刻を比べる計算はしない
  const needsReauth = serverRejectedReauth || meQuery.data?.sessionIsFresh === false;

  function handleReauth() {
    if (isSigningInRef.current) return;
    isSigningInRef.current = true;
    setIsSigningIn(true);
    // sign-in.tsxと同じ理由（signIn.socialのPromiseはredirect開始直後に
    // resolveするため、成功時は遷移完了までボタンを戻さない）
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

    // 【security-auditor指摘】削除自体は成功したのに、signOut()側の失敗を
    // 同じtryで拾うと「削除できませんでした」と誤って表示してしまう
    // （実際には既に消えている）。削除の成否とsignOut()の成否を別に扱う。
    //
    // サーバ側では既にsession/userが消えているが、画面はまだ知らない
    // （024タスク定義「サインアウトする。セッションはサーバ側で消えている
    // が、画面が知らない」）。signOut()でクライアント側の状態を切り替える。
    // 識別が変わればStack.Protectedのguardが自然にサインイン画面へ導く
    // （明示的なnavigateは要らない。PR #177の教訓）。
    // 【security-auditor指摘】削除は「見えなくする」ではなく「消す」操作
    // なので、viewerKeyでの隔離（T9）に加えてキャッシュ自体も明示的に破棄する
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
          // 読み込み中はsessionIsFreshが分からず、確認画面に入れるかを
          // 判定できない（profile.tsxと同じ理由。空欄のまま表示しない）
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
              <Button
                variant="secondary"
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

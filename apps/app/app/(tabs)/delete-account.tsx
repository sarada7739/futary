import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Button, Card, colors, radius, Screen, space, Text } from "@futary/ui";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { orpc } from "../../lib/orpc";
import { signOut } from "../../lib/auth-client";

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
  const deleteMe = useMutation(orpc.me.delete.mutationOptions());

  async function handleDelete() {
    if (!acknowledged) return;
    setErrorMessage(null);
    try {
      await deleteMe.mutateAsync();
      // サーバ側では既にsession/userが消えているが、画面はまだ知らない
      // （024タスク定義「サインアウトする。セッションはサーバ側で消えている
      // が、画面が知らない」）。signOut()でクライアント側の状態を切り替える。
      // 識別が変わればStack.Protectedのguardが自然にサインイン画面へ導く
      // （明示的なnavigateは要らない。PR #177の教訓）
      await signOut();
    } catch {
      setErrorMessage("削除できませんでした。もう一度お試しください");
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Text size="lg" weight="bold">
          ふたりのデータを削除
        </Text>

        {stage === 1 ? (
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

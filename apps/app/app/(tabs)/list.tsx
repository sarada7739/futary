import { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import type { Wish } from "@futary/contract";
import { Button, colors, radius, Screen, space, Text } from "@futary/ui";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useGuestMode } from "../../lib/guest-mode";
import { orpc } from "../../lib/orpc";
import { queryClient } from "../../lib/query";
import { useViewerQueryKey } from "../../lib/viewer-key";

const MAX_TITLE_LENGTH = 100;

// post-card.tsxのDeleteMenuと同じ形。確認せず即削除しない
function WishDeleteControl({ onDelete }: { onDelete: () => void | Promise<void> }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="ghost" onPress={() => setConfirming(true)}>
        削除
      </Button>
    );
  }

  return (
    <View style={{ flexDirection: "row", gap: space.xs }}>
      <Button variant="ghost" onPress={() => setConfirming(false)}>
        キャンセル
      </Button>
      <Button variant="secondary" onPress={onDelete}>
        削除する
      </Button>
    </View>
  );
}

// 021のcanEditのような行ごとの権限は無い（タスク定義4節。権限はペアで共有）。
// editableはisGuestModeだけで決まる。ゲストは押せる形にしない
// （押してからサーバに拒まれる形にしない。014の導線に合わせる）
function WishRow({
  wish,
  editable,
  onToggle,
  onDelete,
}: {
  wish: Wish;
  editable: boolean;
  onToggle: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}) {
  const isDone = wish.doneAt !== null;
  const checkboxGlyph = isDone ? "☑" : "☐";

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      {editable ? (
        <Button
          variant="ghost"
          onPress={onToggle}
          accessibilityLabel={isDone ? "達成済みを外す" : "達成済みにする"}
        >
          {checkboxGlyph}
        </Button>
      ) : (
        <Text size="lg">{checkboxGlyph}</Text>
      )}
      {/* @futary/ui のTextはstyleを持たない（design tokenの外から上書きさせない
          設計。text.tsx参照）ため、取り消し線は使わず色だけで達成済みを示す */}
      <View style={{ flex: 1 }}>
        <Text color={isDone ? "muted" : undefined}>{wish.title}</Text>
      </View>
      {editable && <WishDeleteControl onDelete={onDelete} />}
    </View>
  );
}

// 020のホーム機能パネル「リスト」の行き先。ボトムタブには出さない
// （(tabs)の中に置き、memory.tsx・stats.tsxと同じ扱い。architecture.md 3節）
export default function ListScreen() {
  const { isGuestMode, exitGuestMode } = useGuestMode();
  const [title, setTitle] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // queryKeyにviewerKeyを含める理由はapps/app/lib/viewer-key.ts参照（T9）
  const viewerKey = useViewerQueryKey();
  const listOptions = orpc.wish.list.queryOptions();
  const query = useQuery({ ...listOptions, queryKey: [...listOptions.queryKey, viewerKey] });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.wish.list.key() });
  const createWish = useMutation(orpc.wish.create.mutationOptions({ onSuccess: invalidate }));
  const setDone = useMutation(orpc.wish.setDone.mutationOptions({ onSuccess: invalidate }));
  const deleteWish = useMutation(orpc.wish.delete.mutationOptions({ onSuccess: invalidate }));

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0;

  async function handleAdd() {
    if (!canSubmit) return;
    setErrorMessage(null);
    try {
      await createWish.mutateAsync({ title: trimmedTitle });
      setTitle("");
    } catch (error) {
      if (error instanceof ORPCError && error.code === "LIMIT_REACHED") {
        setErrorMessage("これ以上は追加できません");
      } else {
        setErrorMessage("追加できませんでした。もう一度お試しください");
      }
    }
  }

  async function handleToggle(wish: Wish) {
    setErrorMessage(null);
    try {
      await setDone.mutateAsync({ id: wish.id, done: wish.doneAt === null });
    } catch {
      setErrorMessage("更新できませんでした。もう一度お試しください");
    }
  }

  async function handleDelete(wish: Wish) {
    setErrorMessage(null);
    try {
      await deleteWish.mutateAsync({ id: wish.id });
    } catch {
      setErrorMessage("削除できませんでした。もう一度お試しください");
    }
  }

  const items = query.data?.items ?? [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        {isGuestMode ? (
          // 014の導線に合わせる。入力欄自体を出さず、押してからサーバに
          // 拒まれる形にしない
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text color="muted">追加はログインすると使えます</Text>
            <Button variant="ghost" onPress={exitGuestMode}>
              ログイン
            </Button>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="行きたい場所、食べたいもの…"
              placeholderTextColor={colors.textMuted}
              maxLength={MAX_TITLE_LENGTH}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.input,
                padding: space.md,
                fontSize: 16,
                color: colors.text,
              }}
            />
            {/* Button自体が同一クリック内の二重発火を防ぐが（button.tsx参照）、
                応答待ちの間は見た目でも押せない状態を示す
                （conventions.md「副作用を伴うボタンは二重発火を防ぐ」・
                security-auditor指摘。compose.tsx/calendar.tsxと同じ形） */}
            <Button onPress={handleAdd} disabled={!canSubmit || createWish.isPending}>
              追加
            </Button>
          </View>
        )}

        {errorMessage && <Text color="muted">{errorMessage}</Text>}

        {query.isLoading ? (
          <View style={{ alignItems: "center", padding: space.xl }}>
            <Text color="muted">読み込み中…</Text>
          </View>
        ) : query.isError ? (
          <View style={{ alignItems: "center", gap: space.md, padding: space.xl }}>
            <Text color="muted">読み込めませんでした</Text>
            <Button
              variant="secondary"
              onPress={async () => {
                await query.refetch();
              }}
            >
              再試行
            </Button>
          </View>
        ) : items.length === 0 ? (
          <View style={{ alignItems: "center", padding: space.xl }}>
            <Text color="muted">行きたい場所や食べたいものを書き留めておけます</Text>
          </View>
        ) : (
          <View style={{ gap: space.sm }}>
            {items.map((wish) => (
              <WishRow
                key={wish.id}
                wish={wish}
                editable={!isGuestMode}
                onToggle={() => handleToggle(wish)}
                onDelete={() => handleDelete(wish)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

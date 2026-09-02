import { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import type { Wish } from "@futary/contract";
import { MAX_WISH_NOTE_LENGTH, MAX_WISH_TITLE_LENGTH } from "@futary/contract";
import { Button, colors, radius, Screen, space, Text } from "@futary/ui";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useGuestMode } from "../../lib/guest-mode";
import { orpc } from "../../lib/orpc";
import { queryClient } from "../../lib/query";
import { useViewerQueryKey } from "../../lib/viewer-key";

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

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.input,
  padding: space.md,
  fontSize: 16,
  color: colors.text,
} as const;

// 028: タイトル・メモを編集するインラインフォーム。モーダルにしない
// （027の「入力はモーダルにしない」と同じ考え方を編集にも引き継ぐ）
function WishEditForm({
  wish,
  onSave,
  onCancel,
}: {
  wish: Wish;
  onSave: (values: { title: string; note: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(wish.title);
  const [note, setNote] = useState(wish.note);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const canSave = trimmedTitle.length > 0 && trimmedTitle.length <= MAX_WISH_TITLE_LENGTH && note.length <= MAX_WISH_NOTE_LENGTH;

  async function handleSave() {
    if (!canSave) return;
    setErrorMessage(null);
    setIsSaving(true);
    try {
      await onSave({ title: trimmedTitle, note });
    } catch {
      setErrorMessage("保存できませんでした。もう一度お試しください");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <TextInput
        testID="wish-edit-title"
        value={title}
        onChangeText={setTitle}
        placeholder="行きたい場所、食べたいもの…"
        placeholderTextColor={colors.textMuted}
        maxLength={MAX_WISH_TITLE_LENGTH}
        style={inputStyle}
      />
      <TextInput
        testID="wish-edit-note"
        value={note}
        onChangeText={setNote}
        placeholder="メモ（任意）"
        placeholderTextColor={colors.textMuted}
        maxLength={MAX_WISH_NOTE_LENGTH}
        multiline
        style={{ ...inputStyle, minHeight: 60, textAlignVertical: "top" }}
      />
      {errorMessage && <Text color="muted">{errorMessage}</Text>}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button variant="ghost" onPress={onCancel}>
            キャンセル
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button onPress={handleSave} disabled={!canSave || isSaving}>
            {isSaving ? "保存中…" : "保存"}
          </Button>
        </View>
      </View>
    </View>
  );
}

// 021のcanEditのような行ごとの権限は無い（タスク定義2節。権限はペアで共有。
// 名前を出しても「持ち主」に見せない——押せる/押せないの差を名前の横に
// 作らない）。editableはisGuestModeだけで決まる。ゲストは押せる形にしない
// （押してからサーバに拒まれる形にしない。014の導線に合わせる）
function WishRow({
  wish,
  editable,
  onToggle,
  onDelete,
  onUpdate,
}: {
  wish: Wish;
  editable: boolean;
  onToggle: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onUpdate: (values: { title: string; note: string }) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const isDone = wish.doneAt !== null;
  const checkboxGlyph = isDone ? "☑" : "☐";

  if (isEditing) {
    return (
      <WishEditForm
        wish={wish}
        onCancel={() => setIsEditing(false)}
        onSave={async (values) => {
          await onUpdate(values);
          setIsEditing(false);
        }}
      />
    );
  }

  return (
    <View style={{ gap: space.xs }}>
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
          {/* 設定者の名前（028）。誰が入れたかが読めるが、編集の可否には
              一切関係しない（押せる/押せないの差を名前の横に作らない） */}
          {wish.createdByName && (
            <Text size="xs" color="muted">
              {wish.createdByName}
            </Text>
          )}
        </View>
        {editable && (
          <Button variant="ghost" onPress={() => setIsEditing(true)}>
            編集
          </Button>
        )}
        {editable && <WishDeleteControl onDelete={onDelete} />}
      </View>
      {/* メモは一覧にそのまま出す。折りたたまない（028タスク定義3節） */}
      {wish.note.length > 0 && (
        <Text testID="wish-note" size="sm" color="muted">
          {wish.note}
        </Text>
      )}
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
  const updateWish = useMutation(orpc.wish.update.mutationOptions({ onSuccess: invalidate }));
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

  async function handleUpdate(wish: Wish, values: { title: string; note: string }) {
    // 変更されなかった項目もそのまま渡してよい（サーバはCOALESCEで
    // 同じ値を書き戻すだけ。渡さない最適化はしない）
    await updateWish.mutateAsync({ id: wish.id, title: values.title, note: values.note });
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
              maxLength={MAX_WISH_TITLE_LENGTH}
              style={{ ...inputStyle, flex: 1 }}
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
                onUpdate={(values) => handleUpdate(wish, values)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Button, Card, colors, radius, space, Text } from "@futary/ui";
import { EVENT_KIND_LABELS, EVENT_KIND_ORDER, type EventKind } from "../lib/event-kind";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// eventInputSchema（packages/contract/src/event.ts）と同じ下限。
// 上限はここでは強制しない（超えたらサーバのエラーメッセージで気づく）
const MAX_TITLE_LENGTH = 200;

export type EventFormValues = {
  date: string;
  title: string;
  kind: EventKind;
  repeatYearly: boolean;
};

export type EventFormProps = {
  visible: boolean;
  mode: "create" | "edit";
  defaultDate: string;
  defaultTitle?: string;
  defaultKind?: EventKind;
  // 射影された記念日（表示上の日付 ≠ 登録された日付）を編集しているときの注記
  sourceDateNote?: string;
  isSubmitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: EventFormValues) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onCancel: () => void;
};

export function EventForm({
  visible,
  mode,
  defaultDate,
  defaultTitle,
  defaultKind,
  sourceDateNote,
  isSubmitting,
  errorMessage,
  onSubmit,
  onDelete,
  onCancel,
}: EventFormProps) {
  const [date, setDate] = useState(defaultDate);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [kind, setKind] = useState<EventKind>(defaultKind ?? "plan");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 開くたび（別のイベントを編集し直す場合を含む）に初期値へ揃える
  useEffect(() => {
    if (!visible) return;
    setDate(defaultDate);
    setTitle(defaultTitle ?? "");
    setKind(defaultKind ?? "plan");
    setConfirmingDelete(false);
  }, [visible, defaultDate, defaultTitle, defaultKind]);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && DATE_PATTERN.test(date);

  async function handleSubmit() {
    if (!canSubmit) return;
    // 記念日を選ぶと repeat_yearly が自動で true になる（タスク011）
    await onSubmit({ date, title: trimmedTitle, kind, repeatYearly: kind === "anniversary" });
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg }}>
        {/* 背景は独立したレイヤーとして下に敷く（Pressable の親子でstopPropagationを
            扱う必要を無くす。017で当たり判定の穴を踏んだのと同じ回避）。
            フォーム本体はその上に描画されるため、背景タップだけがここに到達する */}
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="キャンセル"
          testID="event-form-backdrop"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        />

        <View style={{ width: "100%", maxWidth: 480 }}>
          <Card>
            <View style={{ gap: space.md }}>
              <Text weight="bold" size="lg">
                {mode === "edit" ? "イベントを編集" : "イベントを追加"}
              </Text>

              <View style={{ gap: space.xs }}>
                <Text size="sm" color="muted">
                  日付
                </Text>
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textMuted}
                  testID="event-form-date"
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.input,
                    padding: space.md,
                    fontSize: 16,
                    color: colors.text,
                  }}
                />
                {sourceDateNote && (
                  <Text size="xs" color="muted">
                    {sourceDateNote}
                  </Text>
                )}
              </View>

              <View style={{ gap: space.xs }}>
                <Text size="sm" color="muted">
                  タイトル
                </Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="イベントの名前"
                  placeholderTextColor={colors.textMuted}
                  maxLength={MAX_TITLE_LENGTH}
                  testID="event-form-title"
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.input,
                    padding: space.md,
                    fontSize: 16,
                    color: colors.text,
                  }}
                />
              </View>

              <View style={{ gap: space.xs }}>
                <Text size="sm" color="muted">
                  種別
                </Text>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  {EVENT_KIND_ORDER.map((k) => (
                    <View key={k} style={{ flex: 1 }}>
                      <Button
                        variant={kind === k ? "primary" : "secondary"}
                        onPress={() => setKind(k)}
                        testID={`event-form-kind-${k}`}
                      >
                        {EVENT_KIND_LABELS[k]}
                      </Button>
                    </View>
                  ))}
                </View>
                {kind === "anniversary" && (
                  <Text size="xs" color="muted">
                    記念日は毎年繰り返し表示されます
                  </Text>
                )}
              </View>

              {errorMessage && (
                <Text size="sm" color="muted">
                  {errorMessage}
                </Text>
              )}

              <View style={{ flexDirection: "row", gap: space.sm, justifyContent: "flex-end" }}>
                {mode === "edit" &&
                  onDelete &&
                  (confirmingDelete ? (
                    <>
                      <Button variant="ghost" onPress={() => setConfirmingDelete(false)}>
                        キャンセル
                      </Button>
                      <Button variant="secondary" onPress={onDelete} testID="event-form-delete-confirm">
                        削除する
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" onPress={() => setConfirmingDelete(true)} testID="event-form-delete">
                      削除
                    </Button>
                  ))}
                {!confirmingDelete && (
                  <>
                    <Button variant="ghost" onPress={onCancel}>
                      閉じる
                    </Button>
                    <Button
                      onPress={handleSubmit}
                      disabled={!canSubmit}
                      testID="event-form-submit"
                    >
                      {isSubmitting ? "保存中…" : "保存する"}
                    </Button>
                  </>
                )}
              </View>
            </View>
          </Card>
        </View>
      </View>
    </Modal>
  );
}
